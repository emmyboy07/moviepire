import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { loadTv, loadLanguageQualities } from "@/lib/media.functions";
import { loadVixSrcTv } from "@/lib/vixsrc.functions";
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
  server: z.enum(["alpha", "blaze"]).optional(),
  para: z.union([z.string(), z.boolean()]).optional(),
});

export const Route = createFileRoute(
  "/embed/tv/$tmdbId/$season/$episode",
)({
  validateSearch: (search) => {
    const normalized = Object.fromEntries(
      Object.entries(search).map(([key, value]) => [
        key,
        typeof value === "boolean" || typeof value === "number" ? String(value) : value,
      ]),
    );
    return streamSearchSchema.parse(normalized);
  },
  head: () => ({
    meta: [
      { title: "Streaming Series Ã¢â‚¬â€ Moviepire" },
      { name: "description", content: "Stream TV show episodes instantly in premium quality." },
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
  languages: { code: string; label: string; subjectId: string; detailPath: string }[];
}

function SeriesStream() {
  const { tmdbId, season, episode } = Route.useParams();
  const { logo, color, download, autoplay, title, server, para } = Route.useSearch();
  const fetchTv = useServerFn(loadTv);
  const fetchLanguageQualities = useServerFn(loadLanguageQualities);
  const fetchVixSrcTv = useServerFn(loadVixSrcTv);

  const playerColor = useMemo(() => {
    if (!color) return "#d946ef";
    return color.startsWith("#") ? color : `#${color}`;
  }, [color]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [alphaStreamUrl, setAlphaStreamUrl] = useState<string | null>(null);
  const [activeServer, setActiveServer] = useState<"alpha" | "blaze">("alpha");
  const [alphaAvailable, setAlphaAvailable] = useState(false);

  const [selectedLang, setSelectedLang] = useState<string>("");
  const [selectedQualityId, setSelectedQualityId] = useState<string>("");
  const [loadingLang, setLoadingLang] = useState(false);

  const parsedSeason = useMemo(() => parseInt(season, 10) || 1, [season]);
  const parsedEpisode = useMemo(() => parseInt(episode, 10) || 1, [episode]);

  // Ã¢â€â‚¬Ã¢â€â‚¬ Alpha (vixsrc) auto-recovery Ã¢â‚¬â€ see movie route for full rationale.
  // A stale /api/hls-proxy session mid-playback gets re-resolved
  // automatically instead of surfacing an error, with position preserved.
  const playerRef = useRef<{ seek: (time: number) => void }>(null);
  const lastPositionRef = useRef(0);
  const alphaRetryRef = useRef(0);
  const ALPHA_MAX_RETRIES = 3;

  const handleAlphaError = useCallback(() => {
    if (activeServer !== "alpha") return;

    if (alphaRetryRef.current >= ALPHA_MAX_RETRIES) {
      console.error("[Alpha] exhausted retries, falling back to Blaze");
      if (result) {
        setActiveServer("blaze");
      } else {
        setError("Alpha stream is currently unavailable. Please try the Blaze server.");
      }
      return;
    }

    alphaRetryRef.current += 1;
    const attempt = alphaRetryRef.current;

    setTimeout(async () => {
      try {
        const resp = await fetchVixSrcTv({
          data: { tmdbId, season: parsedSeason, episode: parsedEpisode, language: "en" },
        });
        if (resp.ok) {
          console.warn(`[Alpha] session stale, re-resolved (attempt ${attempt})`);
          setAlphaStreamUrl(resp.data.url);
          requestAnimationFrame(() => {
            playerRef.current?.seek(lastPositionRef.current);
          });
        } else if (result) {
          setActiveServer("blaze");
        }
      } catch {
        if (result) setActiveServer("blaze");
      }
    }, 800 * attempt);
  }, [activeServer, tmdbId, result, fetchVixSrcTv]);

  useEffect(() => {
    const baseTitle = title || result?.title;
    if (baseTitle) {
      document.title = `${baseTitle} S${season} : E${episode} Ã¢â‚¬â€ Moviepire`;
    } else {
      document.title = "Streaming Series Ã¢â‚¬â€ Moviepire";
    }
  }, [result, title, season, episode]);

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
          server !== "alpha"
            ? fetchTv({ data: { tmdbId: id, season: parsedSeason, episode: parsedEpisode } })
            : null;
        const alphaPromise =
          server !== "blaze"
            ? fetchVixSrcTv({ data: { tmdbId, season: parsedSeason, episode: parsedEpisode, language: "en" } })
            : null;

        const [blazeResp, alphaResp] = await Promise.all([blazePromise, alphaPromise]);

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
          if (!blazeResp.ok) {
            if (!alphaResp?.ok) setError(blazeResp.error || "Failed to load series episode details");
          } else {
            setResult(blazeResp.data as Result);
            setCaptions((blazeResp.data as Result).captions ?? []);
            // Only make Blaze active if it was explicitly requested, or if Alpha
            // failed to resolve at all.
            if (server === "blaze" || !alphaResp?.ok) setActiveServer("blaze");
          }
        } else if (!alphaResp?.ok) {
          setError("Stream unavailable on Alpha server");
        }
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load episode");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [tmdbId, parsedSeason, parsedEpisode, server]);

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
          const langData = resp.data as { qualities: Quality[]; captions: Caption[] };
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
    return () => { active = false; };
  }, [selectedLang, parsedSeason, parsedEpisode]);

  const languagesFromQualities = useMemo(() => {
    if (!result) return [];
    return result.languages.map((lang) => ({
      key: `${lang.code}|${lang.label}`,
      code: lang.code,
      label: lang.label,
    }));
  }, [result]);

  const filteredQualities = useMemo(() => {
    if (!result) return [];
    return selectedLang
      ? result.qualities.filter(
          (q) => `${q.language}|${q.languageLabel}` === selectedLang,
        )
      : result.qualities;
  }, [result, selectedLang]);

  useEffect(() => {
    if (filteredQualities.length && !filteredQualities.find((q) => q.id === selectedQualityId)) {
      setSelectedQualityId(filteredQualities[0].id);
    }
  }, [filteredQualities, selectedQualityId]);

  const currentQuality = useMemo(
    () => filteredQualities.find((q) => q.id === selectedQualityId) ?? filteredQualities[0],
    [filteredQualities, selectedQualityId],
  );

  // Blaze has one delivery path now (local /api/proxy-stream), so a failure
  // there is a real error rather than something to retry through a fallback.
  const handleBlazeError = useCallback(() => {
    console.error("[Blaze] stream failed");
    setError("This stream is currently unavailable. Try another quality or server.");
  }, []);

  const currentBlazeStreamUrl = useMemo(() => {
    const raw = currentQuality?.url;
    if (!raw) return null;
    return blazeStreamUrl(raw);
  }, [currentQuality]);

  const showServerIcon = para !== "false" && para !== false;

  const effectiveStreamUrl =
    activeServer === "alpha" && alphaStreamUrl ? alphaStreamUrl : currentBlazeStreamUrl;

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#07070b] gap-4">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl shadow-lg"
          style={{
            background: `linear-gradient(135deg, ${playerColor}, ${playerColor}99)`,
            boxShadow: `0 8px 24px ${playerColor}40`,
          }}
        >
          <Loader2 className="h-6 w-6 animate-spin text-white" />
        </div>
        <p className="text-sm font-semibold tracking-wide text-white/60 animate-pulse">
          Loading series stream...
        </p>
      </div>
    );
  }

  if (error || (!result && !alphaStreamUrl)) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#07070b] px-6">
        <div className="w-full max-w-md rounded-2xl border border-red-500/20 bg-red-500/[0.02] p-6 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-bold text-white">Stream Unavailable</h3>
          <p className="mt-2 text-sm leading-relaxed text-white/60">
            {error || "Could not retrieve the series episode stream. Please verify the TMDB ID, season, and episode."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black select-none">
      {effectiveStreamUrl ? (
        <PremiumPlayer
          ref={playerRef}
          streamUrl={effectiveStreamUrl}
          title={title || result?.title}
          poster={result?.backdrop || result?.poster}
          color={playerColor}
          autoplay={typeof autoplay === "boolean" ? autoplay : autoplay !== "false"}
          isPremium={true}
          showVidLuxWatermark={false}
          tmdbId={download === "false" ? undefined : tmdbId}
          type="tv"
          season={season}
          episode={episode}
          onTimeUpdate={(pos) => { lastPositionRef.current = pos; }}
          onError={activeServer === "alpha" ? handleAlphaError : handleBlazeError}
          year={result?.year ?? undefined}
          logo={logo}
          captions={captions.map(c => ({
            ...c,
            url: `/api/proxy-subtitle?url=${encodeURIComponent(c.url)}`
          }))}
          externalQualities={activeServer === "alpha" ? [] : filteredQualities.map(q => ({ id: q.id, label: q.resolution || "Unknown" }))}
          selectedExternalQuality={activeServer === "alpha" ? undefined : selectedQualityId}
          onExternalQualityChange={activeServer === "alpha" ? undefined : setSelectedQualityId}
          externalAudioTracks={activeServer === "alpha" ? [] : languagesFromQualities.map(l => ({ id: l.key, label: l.label }))}
          selectedExternalAudio={activeServer === "alpha" ? undefined : selectedLang}
          onExternalAudioChange={activeServer === "alpha" ? undefined : (key) => {
            if (key !== selectedLang) setSelectedLang(key);
          }}
          showServerIcon={showServerIcon}
          activeServerInfo={{
            name: activeServer === "alpha" ? "Alpha" : "Blaze",
            available: activeServer === "alpha" ? alphaAvailable : !!currentQuality,
            format: activeServer === "alpha" ? "hls" : "mp4",
            languages: activeServer === "alpha" ? ["EN", "HI"] : ["Multi"],
          }}
          availableServers={[
            { id: "alpha", name: "Alpha", available: alphaAvailable, format: "hls", languages: ["EN", "HI"] },
            { id: "blaze", name: "Blaze", available: !!currentQuality, format: "mp4", languages: ["Multi"] },
          ]}
          onServerSwitch={(id) => setActiveServer(id as "alpha" | "blaze")}
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
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: playerColor }} />
        </div>
      )}
    </div>
  );
}
