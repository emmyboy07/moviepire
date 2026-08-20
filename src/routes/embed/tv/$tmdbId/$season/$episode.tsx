import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { loadTv, loadLanguageQualities } from "@/lib/media.functions";
import { loadVixSrcTv } from "@/lib/vixsrc.functions";
import { loadCinemaosTv } from "@/lib/cinemaos.functions";
import type { CinemaosSource } from "@/lib/cinemaos.server";
import { loadTmdbTvMeta } from "@/lib/tmdb.functions";
import type { TmdbTvMeta } from "@/lib/tmdb.server";
import { loadVdrkSubtitlesTv } from "@/lib/subtitles.functions";
import type { VdrkSubtitle } from "@/lib/subtitles.server";
import { useSmartServerProbe } from "@/hooks/use-smart-server-probe";
import {
  resumeKey,
  loadResumePosition,
  saveResumePosition,
  clearResumePosition,
} from "@/lib/resume-watching";
import ServerCheckingOverlay, {
  type CheckingRow,
} from "@/components/player/ServerCheckingOverlay";
import PremiumPlayer from "@/components/player/PremiumPlayer";
import { z } from "zod";

// Blaze mp4 delivery always goes through our own local /api/proxy-stream route
// (see server.ts) - it fetches the aoneroom/netfilm CDN link server-side,
// normalizes the Content-Type (signed CDN links often answer
// application/octet-stream, which <video> refuses to play), and forwards
// Range requests. No external Worker, no Froxy/residential proxy involved.
function blazeStreamUrl(rawUrl: string): string {
  const secure = rawUrl.replace(/^http:\/\//i, "https://");
  return `/api/proxy-stream?url=${encodeURIComponent(secure)}&referer=${encodeURIComponent("https://netfilm.world/")}`;
}

const streamSearchSchema = z.object({
  logo: z.string().optional(),
  color: z.string().optional(),
  download: z.string().optional(),
  autoplay: z.union([z.string(), z.boolean()]).optional(),
  title: z.string().optional(),
  back: z.string().optional(),
  server: z.enum(["alpha", "blaze", "nova"]).optional(),
  para: z.union([z.string(), z.boolean()]).optional(),
});

export const Route = createFileRoute("/embed/tv/$tmdbId/$season/$episode")({
  validateSearch: (search) => {
    const normalized = Object.fromEntries(
      Object.entries(search).map(([key, value]) => [
        key,
        typeof value === "boolean" || typeof value === "number"
          ? String(value)
          : value,
      ]),
    );
    return streamSearchSchema.parse(normalized);
  },
  head: () => ({
    meta: [
      { title: "Streaming Series — Moviepire" },
      {
        name: "description",
        content: "Stream TV show episodes instantly in premium quality.",
      },
    ],
  }),
  component: SeriesStream,
});

interface Quality {
  id: string;
  resolution: string;
  url: string;
  size: number;
  format: string;
  language: string;
  languageLabel: string;
}

interface Caption {
  url: string;
  language: string;
  lang: string;
  label: string;
}

interface Result {
  title: string;
  year: string | null;
  subjectId: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  rating?: number;
  genres?: string[];
  runtime?: number;
  qualities: Quality[];
  captions: Caption[];
  languages: {
    code: string;
    label: string;
    subjectId: string;
    detailPath: string;
  }[];
}

// A stream that never becomes playable (hung connection, dead relay that
// never errors) shouldn't strand the user — give it this long to prove
// itself before we treat it the same as a hard playback error.
const STREAM_LOAD_TIMEOUT_MS = 12000;

function SeriesStream() {
  const { tmdbId, season, episode } = Route.useParams();
  const { logo, color, download, autoplay, title, server, para } =
    Route.useSearch();
  const navigate = Route.useNavigate();
  const fetchTv = useServerFn(loadTv);
  const fetchLanguageQualities = useServerFn(loadLanguageQualities);
  const fetchVixSrcTv = useServerFn(loadVixSrcTv);
  const fetchCinemaosTv = useServerFn(loadCinemaosTv);
  const fetchTmdbMeta = useServerFn(loadTmdbTvMeta);
  const fetchVdrkSubtitles = useServerFn(loadVdrkSubtitlesTv);

  const playerColor = useMemo(() => {
    if (!color) return "#d946ef";
    return color.startsWith("#") ? color : `#${color}`;
  }, [color]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [tmdbMeta, setTmdbMeta] = useState<TmdbTvMeta | null>(null);
  const [vdrkSubtitles, setVdrkSubtitles] = useState<VdrkSubtitle[]>([]);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [alphaStreamUrl, setAlphaStreamUrl] = useState<string | null>(null);
  const [activeServer, setActiveServer] = useState<string>("alpha");
  const [alphaAvailable, setAlphaAvailable] = useState(false);
  const [novaSources, setNovaSources] = useState<CinemaosSource[] | null>(null);
  const [novaConfirmedId, setNovaConfirmedId] = useState<string | null>(null);
  const probe = useSmartServerProbe({ sources: novaSources });

  const [selectedLang, setSelectedLang] = useState<string>("");
  const [selectedQualityId, setSelectedQualityId] = useState<string>("");
  const [loadingLang, setLoadingLang] = useState(false);

  const parsedSeason = useMemo(() => parseInt(season, 10) || 1, [season]);
  const parsedEpisode = useMemo(() => parseInt(episode, 10) || 1, [episode]);

  // ── Alpha (vixsrc) auto-recovery — see movie route for full rationale.
  // A stale /api/hls-proxy session mid-playback gets re-resolved
  // automatically instead of surfacing an error, with position preserved.
  const playerRef = useRef<{ seek: (time: number) => void }>(null);
  const lastPositionRef = useRef(0);
  const alphaRetryRef = useRef(0);
  const ALPHA_MAX_RETRIES = 3;
  const lastGoodServerRef = useRef<string | null>(null);
  const pendingResumeRef = useRef<number | null>(null);
  const hasResumedInitialRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeKeyStr = useMemo(
    () =>
      resumeKey({
        type: "tv",
        tmdbId,
        season: parsedSeason,
        episode: parsedEpisode,
      }),
    [tmdbId, parsedSeason, parsedEpisode],
  );
  const [initialResumeTime] = useState<number | null>(() =>
    loadResumePosition(resumeKeyStr),
  );

  const filteredQualities = useMemo(() => {
    if (!result) return [];
    return selectedLang
      ? result.qualities.filter(
          (q) => `${q.language}|${q.languageLabel}` === selectedLang,
        )
      : result.qualities;
  }, [result, selectedLang]);

  useEffect(() => {
    if (
      filteredQualities.length &&
      !filteredQualities.find((q) => q.id === selectedQualityId)
    ) {
      setSelectedQualityId(filteredQualities[0].id);
    }
  }, [filteredQualities, selectedQualityId]);

  const currentQuality = useMemo(
    () =>
      filteredQualities.find((q) => q.id === selectedQualityId) ??
      filteredQualities[0],
    [filteredQualities, selectedQualityId],
  );

  const currentBlazeStreamUrl = useMemo(() => {
    const raw = currentQuality?.url;
    if (!raw) return null;
    return blazeStreamUrl(raw);
  }, [currentQuality]);

  const activeNova = activeServer.startsWith("nova:")
    ? (probe.candidates.find((c) => `nova:${c.id}` === activeServer) ?? null)
    : null;

  // Fast, uniform fallback shared by Alpha (once its own retries are
  // exhausted), Blaze, and Nova — prefer the last stream that was actually
  // working (resuming from where playback stopped) over gambling on an
  // untested tier.
  const handleStreamFailure = useCallback(() => {
    const failed = activeServer;
    pendingResumeRef.current = lastPositionRef.current;
    if (activeNova) probe.markBadByPlayer(activeNova.id);

    if (lastGoodServerRef.current && lastGoodServerRef.current !== failed) {
      setActiveServer(lastGoodServerRef.current);
      return;
    }
    if (failed !== "blaze" && currentBlazeStreamUrl) {
      setActiveServer("blaze");
      return;
    }
    const next = probe.candidates.find(
      (c) => `nova:${c.id}` !== failed && c.status !== "bad",
    );
    if (next) {
      setActiveServer(`nova:${next.id}`);
      return;
    }
    setError("This stream is currently unavailable. Try another server.");
  }, [activeServer, activeNova, currentBlazeStreamUrl, probe]);

  const handleAlphaError = useCallback(() => {
    if (activeServer !== "alpha") return;

    if (alphaRetryRef.current >= ALPHA_MAX_RETRIES) {
      console.error("[Alpha] exhausted retries, falling back");
      handleStreamFailure();
      return;
    }

    alphaRetryRef.current += 1;
    const attempt = alphaRetryRef.current;

    setTimeout(async () => {
      try {
        const resp = await fetchVixSrcTv({
          data: {
            tmdbId,
            season: parsedSeason,
            episode: parsedEpisode,
            language: "en",
          },
        });
        if (resp.ok) {
          console.warn(
            `[Alpha] session stale, re-resolved (attempt ${attempt})`,
          );
          setAlphaStreamUrl(resp.data.url);
          requestAnimationFrame(() => {
            playerRef.current?.seek(lastPositionRef.current);
          });
        } else {
          handleStreamFailure();
        }
      } catch {
        handleStreamFailure();
      }
    }, 800 * attempt);
  }, [
    activeServer,
    tmdbId,
    parsedSeason,
    parsedEpisode,
    fetchVixSrcTv,
    handleStreamFailure,
  ]);

  useEffect(() => {
    const baseTitle = title || tmdbMeta?.title || result?.title;
    document.title = baseTitle
      ? `${baseTitle} S${season} : E${episode} — Moviepire`
      : "Streaming Series — Moviepire";
  }, [tmdbMeta?.title, result, title, season, episode]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      alphaRetryRef.current = 0;
      lastPositionRef.current = 0;
      try {
        const id = parseInt(tmdbId, 10);
        if (isNaN(id) || id <= 0) throw new Error("Invalid TMDB TV Show ID");

        const blazePromise =
          server !== "alpha" && server !== "nova"
            ? fetchTv({
                data: {
                  tmdbId: id,
                  season: parsedSeason,
                  episode: parsedEpisode,
                },
              })
            : null;
        const alphaPromise =
          server !== "blaze" && server !== "nova"
            ? fetchVixSrcTv({
                data: {
                  tmdbId,
                  season: parsedSeason,
                  episode: parsedEpisode,
                  language: "en",
                },
              })
            : null;
        const novaPromise =
          server == null || server === "nova"
            ? fetchCinemaosTv({
                data: { tmdbId, season: parsedSeason, episode: parsedEpisode },
              })
            : null;
        const metaPromise = fetchTmdbMeta({ data: { tmdbId } });
        const subsPromise = fetchVdrkSubtitles({
          data: { tmdbId, season: parsedSeason, episode: parsedEpisode },
        });

        const [blazeResp, alphaResp, novaResp, metaResp, subsResp] =
          await Promise.all([
            blazePromise,
            alphaPromise,
            novaPromise,
            metaPromise,
            subsPromise,
          ]);

        if (!active) return;

        if (alphaResp?.ok) {
          setAlphaStreamUrl(alphaResp.data.url);
          setAlphaAvailable(true);
          // Default to Alpha unless Blaze was explicitly requested. See the
          // movie route for the full rationale.
          if (server !== "blaze") {
            setActiveServer("alpha");
          }
        }

        if (blazeResp) {
          if (blazeResp.ok) {
            setResult(blazeResp.data as Result);
            setCaptions((blazeResp.data as Result).captions ?? []);
            // Only make Blaze active if it was explicitly requested, or if Alpha
            // failed to resolve at all.
            if (server === "blaze" || !alphaResp?.ok) setActiveServer("blaze");
          }
        }

        if (novaResp?.ok) {
          setNovaSources(novaResp.data.sources);
        }

        if (metaResp.ok) {
          setTmdbMeta(metaResp.data);
        }

        if (subsResp.ok) {
          setVdrkSubtitles(subsResp.data);
        }
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load episode");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tmdbId, parsedSeason, parsedEpisode, server]);

  // Only reached when neither Alpha nor Blaze panned out — wait for the
  // background probe to confirm a working nova candidate (or exhaust its
  // budget and fall back to the best-scored guess) before ever handing a
  // stream to the player, surfacing progress via the testing screen.
  useEffect(() => {
    if (alphaAvailable || currentBlazeStreamUrl || novaConfirmedId) return;
    if (!novaSources || novaSources.length === 0) return;
    const verified = probe.candidates.find((c) => c.status === "verified");
    if (verified) {
      setNovaConfirmedId(verified.id);
    } else if (!probe.isProbing && probe.candidates.length > 0) {
      setNovaConfirmedId(probe.candidates[0].id);
    }
  }, [
    alphaAvailable,
    currentBlazeStreamUrl,
    novaConfirmedId,
    novaSources,
    probe.candidates,
    probe.isProbing,
  ]);

  useEffect(() => {
    if (novaConfirmedId && !alphaAvailable && !currentBlazeStreamUrl) {
      setActiveServer(`nova:${novaConfirmedId}`);
    }
  }, [novaConfirmedId, alphaAvailable, currentBlazeStreamUrl]);

  useEffect(() => {
    if (!result) return;
    setSelectedLang(
      result.qualities[0]
        ? `${result.qualities[0].language}|${result.qualities[0].languageLabel}`
        : "",
    );
  }, [result]);

  useEffect(() => {
    if (!selectedLang || !result?.languages || !result) return;

    const [, langLabel] = selectedLang.split("|");
    const currentLangLabel = result.qualities[0]?.languageLabel;

    if (currentLangLabel === langLabel) {
      setLoadingLang(false);
      return;
    }

    setLoadingLang(true);

    let active = true;
    (async () => {
      try {
        const langInfo = result.languages.find(
          (l) => `${l.code}|${l.label}` === selectedLang,
        );

        if (langInfo) {
          const resp = await fetchLanguageQualities({
            data: {
              languageSubjectId: langInfo.subjectId,
              languageDetailPath: langInfo.detailPath,
              season: parsedSeason,
              episode: parsedEpisode,
              languageCode: langInfo.code,
              languageLabel: langInfo.label,
            },
          });

          if (!active) return;
          const langData = resp.data as {
            qualities: Quality[];
            captions: Caption[];
          };
          if (resp.ok && result && langData.qualities?.length > 0) {
            setResult({
              ...result,
              qualities: langData.qualities,
            });
            setCaptions(langData.captions ?? []);
          }
        }
      } catch (err) {
        console.error("Failed to fetch language qualities:", err);
      } finally {
        if (active) setLoadingLang(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedLang, parsedSeason, parsedEpisode]);

  const languagesFromQualities = useMemo(() => {
    if (!result) return [];
    return result.languages.map((lang) => ({
      key: `${lang.code}|${lang.label}`,
      code: lang.code,
      label: lang.label,
    }));
  }, [result]);

  const showServerIcon = para !== "false" && para !== false;

  const effectiveStreamUrl =
    activeServer === "alpha" && alphaStreamUrl
      ? alphaStreamUrl
      : activeServer === "blaze"
        ? currentBlazeStreamUrl
        : activeNova
          ? activeNova.url
          : null;

  const effectiveStreamType = activeNova ? activeNova.type : "auto";

  // Watchdog: a stream that hangs without ever firing a fatal error (or
  // `onPlaybackReady`) would otherwise strand the user on a black screen
  // forever. Give each attempt a fixed window to prove itself.
  useEffect(() => {
    if (!effectiveStreamUrl) return;
    watchdogRef.current = setTimeout(
      handleStreamFailure,
      STREAM_LOAD_TIMEOUT_MS,
    );
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveStreamUrl]);

  // Every server we know about so far, normalized to one shape — see the
  // movie route for the full rationale.
  const unifiedServers: CheckingRow[] = [
    ...(server == null || server === "alpha"
      ? [
          {
            id: "alpha",
            displayName: "Alpha",
            status: loading ? "checking" : alphaAvailable ? "verified" : "bad",
            type: "hls",
          } as CheckingRow,
        ]
      : []),
    ...(server == null || server === "blaze"
      ? [
          {
            id: "blaze",
            displayName: "Blaze",
            status: loading
              ? "checking"
              : currentBlazeStreamUrl
                ? "verified"
                : "bad",
            type: "mp4",
          } as CheckingRow,
        ]
      : []),
    ...probe.candidates.map((c): CheckingRow => ({
      id: `nova:${c.id}`,
      displayName: c.displayName,
      status: c.status,
      type: c.type,
      quality: c.quality,
      speed: c.speed,
    })),
  ];

  const posterUrl =
    tmdbMeta?.backdrop ||
    tmdbMeta?.poster ||
    result?.backdrop ||
    result?.poster;
  const displayTitle = title || tmdbMeta?.title || result?.title;

  const needsTesting =
    loading ||
    (!alphaAvailable &&
      !currentBlazeStreamUrl &&
      !!novaSources &&
      novaSources.length > 0 &&
      !novaConfirmedId);

  if (needsTesting && !error) {
    return (
      <ServerCheckingOverlay
        color={playerColor}
        poster={posterUrl}
        title={displayTitle}
        candidates={unifiedServers}
      />
    );
  }

  if (error || (!effectiveStreamUrl && !result && !alphaStreamUrl)) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#07070b] px-6">
        <div className="w-full max-w-md rounded-2xl border border-red-500/20 bg-red-500/[0.02] p-6 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Stream Unavailable</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/60">
            {error ||
              "Could not retrieve the series episode stream. Please verify the TMDB ID, season, and episode."}
          </p>
        </div>
      </div>
    );
  }

  const goToEpisode = (nextSeason: number, nextEpisode: number) => {
    navigate({
      to: "/embed/tv/$tmdbId/$season/$episode",
      params: {
        tmdbId,
        season: String(nextSeason),
        episode: String(nextEpisode),
      },
      search: (prev) => prev,
    });
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black select-none">
      {effectiveStreamUrl ? (
        <PremiumPlayer
          ref={playerRef}
          streamUrl={effectiveStreamUrl}
          streamType={effectiveStreamType}
          title={displayTitle}
          poster={posterUrl}
          color={playerColor}
          autoplay={
            typeof autoplay === "boolean" ? autoplay : autoplay !== "false"
          }
          isPremium={true}
          showVidLuxWatermark={false}
          tmdbId={download === "false" ? undefined : tmdbId}
          type="tv"
          season={season}
          episode={episode}
          onTimeUpdate={(pos) => {
            lastPositionRef.current = pos;
            saveResumePosition(resumeKeyStr, pos);
          }}
          onComplete={() => clearResumePosition(resumeKeyStr)}
          onPlaybackReady={() => {
            if (watchdogRef.current) {
              clearTimeout(watchdogRef.current);
              watchdogRef.current = null;
            }
            if (activeNova) probe.markVerifiedByPlayer(activeNova.id);
            lastGoodServerRef.current = activeServer;
            if (pendingResumeRef.current != null) {
              playerRef.current?.seek(pendingResumeRef.current);
              pendingResumeRef.current = null;
            } else if (!hasResumedInitialRef.current) {
              hasResumedInitialRef.current = true;
              if (initialResumeTime) playerRef.current?.seek(initialResumeTime);
            }
          }}
          onError={
            activeServer === "alpha" ? handleAlphaError : handleStreamFailure
          }
          checkingServerNames={activeNova ? probe.currentlyChecking : []}
          year={tmdbMeta?.year ?? result?.year ?? undefined}
          logo={logo}
          captions={(captions.length > 0
            ? captions
            : vdrkSubtitles.map((s) => ({
                url: s.url,
                label: s.label,
                language: s.label,
                lang: s.label,
              }))
          ).map((c) => ({
            ...c,
            url: `/api/proxy-subtitle?url=${encodeURIComponent(c.url)}`,
          }))}
          externalQualities={
            activeServer === "blaze"
              ? filteredQualities.map((q) => ({
                  id: q.id,
                  label: q.resolution || "Unknown",
                }))
              : []
          }
          selectedExternalQuality={
            activeServer === "blaze" ? selectedQualityId : undefined
          }
          onExternalQualityChange={
            activeServer === "blaze" ? setSelectedQualityId : undefined
          }
          externalAudioTracks={
            activeServer === "blaze"
              ? languagesFromQualities.map((l) => ({
                  id: l.key,
                  label: l.label,
                }))
              : []
          }
          selectedExternalAudio={
            activeServer === "blaze" ? selectedLang : undefined
          }
          onExternalAudioChange={
            activeServer === "blaze"
              ? (key) => {
                  if (key !== selectedLang) setSelectedLang(key);
                }
              : undefined
          }
          showServerIcon={showServerIcon}
          activeServerInfo={{
            name: activeNova
              ? activeNova.displayName
              : activeServer === "alpha"
                ? "Alpha"
                : "Blaze",
            available: activeNova
              ? activeNova.status !== "bad"
              : activeServer === "alpha"
                ? alphaAvailable
                : !!currentBlazeStreamUrl,
            format: activeNova
              ? activeNova.type
              : activeServer === "alpha"
                ? "hls"
                : "mp4",
            languages: activeNova
              ? []
              : activeServer === "alpha"
                ? ["EN", "HI"]
                : ["Multi"],
          }}
          availableServers={[
            {
              id: "alpha",
              name: "Alpha",
              available: alphaAvailable,
              format: "hls",
              languages: ["EN", "HI"],
            },
            {
              id: "blaze",
              name: "Blaze",
              available: !!currentBlazeStreamUrl,
              format: "mp4",
              languages: ["Multi"],
            },
            ...probe.candidates.map((c) => ({
              id: `nova:${c.id}`,
              name: c.displayName,
              available: c.status === "verified",
              checking: c.status === "checking",
              bad: c.status === "bad",
              format: c.type,
              languages: [] as string[],
              quality: c.quality,
              speed: c.speed,
              verified: c.verified,
            })),
          ]}
          onServerSwitch={(id) => {
            pendingResumeRef.current = lastPositionRef.current;
            setActiveServer(id);
          }}
          seriesData={
            tmdbMeta?.seasons.length ? { seasons: tmdbMeta.seasons } : undefined
          }
          onEpisodeChange={(nextSeason, nextEpisode) =>
            goToEpisode(nextSeason, nextEpisode)
          }
          onNextEpisode={() => {
            const currentSeasonInfo = tmdbMeta?.seasons.find(
              (s) => s.season_number === parsedSeason,
            );
            if (
              currentSeasonInfo &&
              parsedEpisode < currentSeasonInfo.episode_count
            ) {
              goToEpisode(parsedSeason, parsedEpisode + 1);
              return;
            }
            const nextSeasonInfo = tmdbMeta?.seasons.find(
              (s) => s.season_number === parsedSeason + 1,
            );
            if (nextSeasonInfo) goToEpisode(parsedSeason + 1, 1);
          }}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[#07070b]">
          <div className="w-full max-w-md rounded-2xl border border-red-500/20 bg-red-500/[0.02] p-6 text-center shadow-2xl backdrop-blur-xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-white">Stream Unavailable</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              No playable source was returned for this episode.
            </p>
          </div>
        </div>
      )}

      {loadingLang && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Loader2
            className="h-8 w-8 animate-spin"
            style={{ color: playerColor }}
          />
        </div>
      )}
    </div>
  );
}
