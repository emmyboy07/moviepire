import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, Download, ChevronDown } from "lucide-react";
import { loadAnime } from "@/lib/media.functions";
import { z } from "zod";

const downloadSearchSchema = z.object({
  back: z.string().optional(),
  color: z.string().optional(),
});

export const Route = createFileRoute("/download/anime/$anilistId/$episode")({
  validateSearch: (search) => downloadSearchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Download Anime Episode — Moviepire" },
      { name: "description", content: "Download anime episodes instantly in any quality." },
    ],
  }),
  component: AnimeDownload,
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
  languages: { code: string; label: string; subjectId: string }[];
  totalEpisodes?: number;
}

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

// Route the actual download through /api/proxy-stream (see server.ts) rather
// than linking the raw CDN url directly - the aoneroom/netfilm CDN answers
// signed links with Content-Type: application/octet-stream and no filename,
// so a bare link either downloads with an opaque hash filename or, in some
// browsers, tries to navigate to it inline. The proxy sets a real
// Content-Disposition with the title/episode/resolution baked in.
function buildDownloadUrl(q: Quality, title: string, episode: number): string {
  const filename = `${title} E${episode} (${q.resolution}p).${q.format || "mp4"}`.replace(/[\\/:*?"<>|]/g, "");
  const params = new URLSearchParams({
    url: q.url,
    referer: "https://netfilm.world/",
    filename,
  });
  return `/api/proxy-stream?${params.toString()}`;
}

function buildSubtitleDownloadUrl(sub: Caption, title: string, episode: number): string {
  const ext = sub.url.split(".").pop()?.split("?")[0] || "srt";
  const filename = `${title} E${episode} - ${sub.label}.${ext}`.replace(/[\\/:*?"<>|]/g, "");
  const params = new URLSearchParams({ url: sub.url, filename });
  return `/api/proxy-subtitle-download?${params.toString()}`;
}

function AnimeDownload() {
  const { anilistId, episode } = Route.useParams();
  const fetchAnime = useServerFn(loadAnime);

  useEffect(() => {
    if (document.getElementById("ad-129065")) return;
    const s = document.createElement("script");
    s.id = "ad-129065";
    s.setAttribute("data-cfasync", "false");
    s.async = true;
    s.type = "text/javascript";
    s.src = "//pb.burnetsasgmt.com/rXptmzwHxVyll/129065";
    document.body.appendChild(s);
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [showSubs, setShowSubs] = useState(false);

  const parsedEpisode = useMemo(() => parseInt(episode, 10) || 1, [episode]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const id = parseInt(anilistId, 10);
        if (isNaN(id) || id <= 0) throw new Error("Invalid AniList ID");
        const resp = await fetchAnime({ data: { anilistId: id, episode: parsedEpisode } });
        if (!active) return;
        if (!resp.ok) {
          setError(resp.error || "Failed to load anime download details");
        } else {
          setResult(resp.data as Result);
          setCaptions((resp.data as Result).captions ?? []);
        }
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load anime");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [anilistId, parsedEpisode]);

  const qualities = useMemo(() => result?.qualities ?? [], [result]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[#0a0a0a]">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-500" />
        <p className="text-sm font-semibold tracking-wide text-white/60 animate-pulse">
          Loading download details...
        </p>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#0a0a0a] px-6 text-center">
        <AlertCircle className="mb-4 h-12 w-12 text-red-500" />
        <h2 className="text-2xl font-bold tracking-tight text-white">Download Unavailable</h2>
        <p className="mt-2 max-w-md text-sm text-white/60">
          {error || "Could not retrieve download links for this episode. Please verify the AniList ID and episode."}
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0a0a0a] text-white">
      <div className="pointer-events-none fixed inset-0 -z-10">
        {result.backdrop ? (
          <img src={result.backdrop} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-emerald-950 via-[#0a0a0a] to-black" />
        )}
        <div className="absolute inset-0 bg-black/70" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/60 to-[#0a0a0a]/30" />
      </div>

      <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center px-6 py-16">
        <h1 className="text-center text-4xl font-extrabold tracking-tight drop-shadow-lg sm:text-5xl">
          {result.title}
          {result.year && <span className="font-extrabold"> ({result.year})</span>}
        </h1>
        <p className="mt-3 text-center text-lg font-semibold text-emerald-400">
          Episode {parsedEpisode}
        </p>

        <p className="mt-5 text-center text-xl font-bold text-white/90">
          MP4 Downloads <span className="text-white/50">(No Subtitles)</span>
        </p>

        <div className="mt-10 flex w-full flex-wrap justify-center gap-4">
          {qualities.length === 0 ? (
            <p className="text-sm text-white/40">No download options available.</p>
          ) : (
            qualities.map((q) => (
              <a
                key={q.id}
                href={buildDownloadUrl(q, result.title, parsedEpisode)}
                target="_blank"
                rel="noreferrer"
                download
                className="group flex min-w-[260px] flex-1 flex-col items-center rounded-2xl border border-white/10 bg-white/[0.06] px-6 py-5 backdrop-blur-md transition hover:border-emerald-500/50 hover:bg-white/[0.1]"
              >
                <span className="text-xl font-extrabold tracking-tight">
                  {q.resolution} <span className="text-white/60">({formatSize(q.size)})</span>
                </span>
                <span className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-white/60 transition group-hover:text-emerald-400">
                  <Download className="h-4 w-4" />
                  Download
                </span>
              </a>
            ))
          )}
        </div>

        {captions.length > 0 && (
          <div className="mt-12 w-full max-w-xl">
            <button
              onClick={() => setShowSubs((s) => !s)}
              className="mx-auto flex items-center gap-2 text-xl font-bold text-white transition hover:text-emerald-400"
            >
              Subtitle Downloads
              <ChevronDown className={`h-5 w-5 transition-transform ${showSubs ? "rotate-180" : ""}`} />
            </button>

            {showSubs && (
              <div className="mt-5 space-y-2">
                {captions.map((sub, i) => (
                  <a
                    key={i}
                    href={buildSubtitleDownloadUrl(sub, result.title, parsedEpisode)}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.05] px-5 py-3.5 backdrop-blur-md transition hover:border-emerald-500/40 hover:bg-white/[0.08]"
                  >
                    <span className="font-semibold">{sub.label}</span>
                    <span className="inline-flex items-center gap-2 text-sm text-white/60">
                      <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                        {sub.url.split(".").pop()?.split("?")[0] || "srt"}
                      </span>
                      <Download className="h-4 w-4" />
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
