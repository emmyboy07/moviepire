import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Film,
  Tv,
  Sparkles,
  Download,
  Send,
  PlayCircle,
  Copy,
  Check,
  RefreshCw,
  Globe2,
  Languages,
  Zap,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SITE_URL = "https://video.moviepire.co";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Moviepire — Free Movie & TV Streaming API + Player Tester" },
      {
        name: "description",
        content:
          "Test the Moviepire embeddable player live for movies and TV shows, grab instant streaming/embed links, or generate direct download links by TMDB or AniList ID.",
      },
      { property: "og:title", content: "Moviepire — Free Movie & TV Streaming API + Player Tester" },
      {
        property: "og:description",
        content:
          "Test the Moviepire embeddable player live for movies and TV shows, grab instant streaming/embed links, or generate direct download links by TMDB or AniList ID.",
      },
      { property: "og:url", content: SITE_URL },
    ],
    links: [{ rel: "canonical", href: SITE_URL }],
  }),
  component: Home,
});

const TELEGRAM_URL = "https://t.me/+kptv4FKWz6VlOGY0";

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <button
      onClick={onCopy}
      type="button"
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-semibold text-neutral-200 transition hover:border-fuchsia-500/50 hover:text-white"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-fuchsia-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function PlayerTester() {
  const [mode, setMode] = useState<"movie" | "tv">("movie");

  const [movieId, setMovieId] = useState("");
  const [tvId, setTvId] = useState("");
  const [tvSeason, setTvSeason] = useState("1");
  const [tvEpisode, setTvEpisode] = useState("1");

  const [testPath, setTestPath] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const movieValid = useMemo(() => /^\d+$/.test(movieId.trim()), [movieId]);
  const tvValid = useMemo(() => /^\d+$/.test(tvId.trim()), [tvId]);

  const origin = typeof window !== "undefined" ? window.location.origin : SITE_URL;

  const loadTest = () => {
    if (mode === "movie" && movieValid) {
      setTestPath(`/embed/movie/${movieId.trim()}`);
    } else if (mode === "tv" && tvValid) {
      const s = tvSeason.trim() || "1";
      const e = tvEpisode.trim() || "1";
      setTestPath(`/embed/tv/${tvId.trim()}/${s}/${e}`);
    }
    setReloadKey((k) => k + 1);
  };

  const embedLink = testPath ? `${origin}${testPath}` : "";
  const embedCode = testPath
    ? `<iframe src="${embedLink}" width="100%" height="480" frameborder="0" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture"></iframe>`
    : "";

  const canLoad = mode === "movie" ? movieValid : tvValid;

  return (
    <div id="player-tester" className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-2">
        <PlayCircle className="h-5 w-5 text-fuchsia-400" />
        <h2 className="text-lg font-bold">Player Tester</h2>
        <span className="ml-auto rounded-full bg-fuchsia-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-300">
          Live Preview
        </span>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "movie" | "tv")}>
        <TabsList className="mb-4 grid w-full grid-cols-2 bg-neutral-900">
          <TabsTrigger value="movie" className="gap-1.5 data-[state=active]:bg-fuchsia-500 data-[state=active]:text-black">
            <Film className="h-4 w-4" /> Movie
          </TabsTrigger>
          <TabsTrigger value="tv" className="gap-1.5 data-[state=active]:bg-fuchsia-500 data-[state=active]:text-black">
            <Tv className="h-4 w-4" /> TV Show
          </TabsTrigger>
        </TabsList>

        <TabsContent value="movie" className="mt-0">
          <input
            inputMode="numeric"
            value={movieId}
            onChange={(e) => setMovieId(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="TMDB Movie ID (e.g. 550)"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none transition focus:border-fuchsia-500/60"
          />
        </TabsContent>

        <TabsContent value="tv" className="mt-0 space-y-3">
          <input
            inputMode="numeric"
            value={tvId}
            onChange={(e) => setTvId(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="TMDB Series ID (e.g. 1399)"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none transition focus:border-fuchsia-500/60"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Season
              </label>
              <input
                inputMode="numeric"
                value={tvSeason}
                onChange={(e) => setTvSeason(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none transition focus:border-fuchsia-500/60"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Episode
              </label>
              <input
                inputMode="numeric"
                value={tvEpisode}
                onChange={(e) => setTvEpisode(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none transition focus:border-fuchsia-500/60"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <button
        onClick={loadTest}
        disabled={!canLoad}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-500 py-3 text-sm font-bold text-black transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <PlayCircle className="h-4 w-4" />
        Load Test Player
      </button>

      {testPath && (
        <div className="mt-6 space-y-4">
          <div className="overflow-hidden rounded-xl border border-neutral-800 bg-black">
            <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/60 px-3 py-2">
              <span className="text-[11px] font-medium text-neutral-400">Live Preview — {testPath}</span>
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="flex items-center gap-1 text-[11px] text-neutral-400 transition hover:text-white"
              >
                <RefreshCw className="h-3 w-3" /> Reload
              </button>
            </div>
            <div className="aspect-video w-full">
              <iframe
                key={reloadKey}
                src={testPath}
                title="Moviepire player test"
                className="h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Streaming / Embed Link
            </label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={embedLink}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="w-full truncate rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-300 outline-none"
              />
              <CopyButton value={embedLink} />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              Iframe Embed Code
            </label>
            <div className="flex items-start gap-2">
              <textarea
                readOnly
                value={embedCode}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                rows={3}
                className="w-full resize-none rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-300 outline-none"
              />
              <CopyButton value={embedCode} />
            </div>
          </div>

          <p className="text-[11px] text-neutral-500">
            Customize with query params like{" "}
            <code className="rounded bg-neutral-900 px-1 py-0.5">?color=a855f7</code>,{" "}
            <code className="rounded bg-neutral-900 px-1 py-0.5">autoplay=false</code>, or{" "}
            <code className="rounded bg-neutral-900 px-1 py-0.5">server=alpha</code> — see the{" "}
            <a href="/api-doc" className="text-fuchsia-400 hover:underline">
              API docs
            </a>
            .
          </p>
        </div>
      )}
    </div>
  );
}

function Home() {
  const [movieId, setMovieId] = useState("");
  const [tvId, setTvId] = useState("");
  const [tvSeason, setTvSeason] = useState("1");
  const [tvEpisode, setTvEpisode] = useState("1");
  const [animeId, setAnimeId] = useState("");
  const [animeEpisode, setAnimeEpisode] = useState("1");

  const go = (path: string) => {
    if (path) window.location.href = path;
  };

  const movieValid = useMemo(() => /^\d+$/.test(movieId.trim()), [movieId]);
  const tvValid = useMemo(() => /^\d+$/.test(tvId.trim()), [tvId]);
  const animeValid = useMemo(() => /^\d+$/.test(animeId.trim()), [animeId]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100">
      <header className="border-b border-neutral-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <a href="/" className="flex items-center gap-2">
            <img
              src="/logo-256.png"
              alt="Moviepire logo"
              width={28}
              height={28}
              className="h-7 w-7 rounded-md"
            />
            <span className="text-sm font-semibold tracking-tight">Moviepire</span>
          </a>
          <nav className="flex items-center gap-5 text-xs text-neutral-400">
            <a href="#player-tester" className="hidden transition hover:text-white sm:inline">
              Player Tester
            </a>
            <a href="/api-doc" className="transition hover:text-white">
              API
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md bg-neutral-100 px-3 py-1.5 font-medium text-black transition hover:bg-white"
            >
              <Send className="h-3 w-3" />
              Join Telegram
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-14">
        <div className="mb-10 text-center">
          <img
            src="/logo-256.png"
            alt="Moviepire"
            width={56}
            height={56}
            className="mx-auto mb-5 h-14 w-14 rounded-2xl shadow-lg shadow-fuchsia-500/20"
          />
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            Stream &amp; Download{" "}
            <span className="bg-gradient-to-r from-fuchsia-400 to-violet-500 bg-clip-text text-transparent">
              Anything
            </span>
          </h1>
          <p className="mt-3 text-sm text-neutral-400">
            Test the live player, get instant embed/streaming links, or download by TMDB / AniList ID.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-neutral-400">
            <span className="rounded-full border border-neutral-800 px-3 py-1">Free API</span>
            <span className="rounded-full border border-neutral-800 px-3 py-1">Multi-Audio &amp; Subtitles</span>
            <span className="rounded-full border border-neutral-800 px-3 py-1">Auto-Updated Sources</span>
          </div>
        </div>

        <div className="space-y-5">
          <PlayerTester />

          {/* Download Links */}
          <div className="pt-2 text-center">
            <h2 className="text-base font-bold text-neutral-300">Direct Download Links</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Prefer a direct file? Generate download links instead of streaming.
            </p>
          </div>

          {/* Movie card */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Film className="h-5 w-5 text-fuchsia-400" />
              <h2 className="text-lg font-bold">Movie</h2>
            </div>
            <input
              inputMode="numeric"
              value={movieId}
              onChange={(e) => setMovieId(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="TMDB ID (e.g. 550)"
              className="mb-3 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none transition focus:border-neutral-600"
            />
            <button
              onClick={() => go(`/download/movie/${movieId.trim()}`)}
              disabled={!movieValid}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-500 py-3 text-sm font-bold text-black transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Get Download Links
            </button>
          </div>

          {/* TV Show card */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Tv className="h-5 w-5 text-fuchsia-400" />
              <h2 className="text-lg font-bold">TV Show</h2>
            </div>
            <input
              inputMode="numeric"
              value={tvId}
              onChange={(e) => setTvId(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="TMDB ID"
              className="mb-3 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none transition focus:border-neutral-600"
            />
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                  Season
                </label>
                <input
                  inputMode="numeric"
                  value={tvSeason}
                  onChange={(e) => setTvSeason(e.target.value.replace(/[^\d]/g, ""))}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none transition focus:border-neutral-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                  Episode
                </label>
                <input
                  inputMode="numeric"
                  value={tvEpisode}
                  onChange={(e) => setTvEpisode(e.target.value.replace(/[^\d]/g, ""))}
                  className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none transition focus:border-neutral-600"
                />
              </div>
            </div>
            <button
              onClick={() =>
                go(`/download/tv/${tvId.trim()}/${tvSeason.trim() || "1"}/${tvEpisode.trim() || "1"}`)
              }
              disabled={!tvValid}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-500 py-3 text-sm font-bold text-black transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Get Download Links
            </button>
          </div>

          {/* Anime card */}
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-fuchsia-400" />
              <h2 className="text-lg font-bold">Anime</h2>
            </div>
            <input
              inputMode="numeric"
              value={animeId}
              onChange={(e) => setAnimeId(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="AniList ID (e.g. 21)"
              className="mb-3 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none transition focus:border-neutral-600"
            />
            <div className="mb-3">
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Episode
              </label>
              <input
                inputMode="numeric"
                value={animeEpisode}
                onChange={(e) => setAnimeEpisode(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm outline-none transition focus:border-neutral-600"
              />
            </div>
            <button
              onClick={() => go(`/download/anime/${animeId.trim()}/${animeEpisode.trim() || "1"}`)}
              disabled={!animeValid}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-fuchsia-500 py-3 text-sm font-bold text-black transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Get Download Links
            </button>
          </div>
        </div>

        {/* Features */}
        <div className="mt-14">
          <h2 className="mb-5 text-center text-base font-bold text-neutral-300">Why Moviepire</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: RefreshCw, label: "Auto-Updated", desc: "Sources refresh automatically" },
              { icon: Globe2, label: "Responsive", desc: "Works on any device" },
              { icon: Languages, label: "Multi-Audio", desc: "Multiple languages & subtitles" },
              { icon: Zap, label: "Free API", desc: "Fast, no auth required" },
            ].map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-center"
              >
                <Icon className="mx-auto mb-2 h-5 w-5 text-fuchsia-400" />
                <p className="text-xs font-semibold text-neutral-200">{label}</p>
                <p className="mt-1 text-[10.5px] leading-snug text-neutral-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-14">
          <h2 className="mb-3 text-center text-base font-bold text-neutral-300">Frequently Asked Questions</h2>
          <Accordion type="single" collapsible className="rounded-2xl border border-neutral-800 bg-neutral-950 px-5">
            <AccordionItem value="q1" className="border-neutral-800">
              <AccordionTrigger className="text-sm text-neutral-200">
                How do I test the player before embedding it?
              </AccordionTrigger>
              <AccordionContent className="text-xs leading-relaxed text-neutral-400">
                Use the Player Tester above — enter a TMDB movie ID, or a TMDB series ID with season and
                episode, then hit "Load Test Player" to preview the exact embed live, plus copy the
                streaming link or iframe code.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q2" className="border-neutral-800">
              <AccordionTrigger className="text-sm text-neutral-200">
                Can I customize the player's color or autoplay behavior?
              </AccordionTrigger>
              <AccordionContent className="text-xs leading-relaxed text-neutral-400">
                Yes. Append query params to any embed link, e.g.{" "}
                <code className="rounded bg-neutral-900 px-1 py-0.5">?color=a855f7&amp;autoplay=false</code>.
                Full details are in the{" "}
                <a href="/api-doc" className="text-fuchsia-400 hover:underline">
                  API docs
                </a>
                .
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q3" className="border-neutral-800">
              <AccordionTrigger className="text-sm text-neutral-200">
                Are subtitles and multiple audio languages supported?
              </AccordionTrigger>
              <AccordionContent className="text-xs leading-relaxed text-neutral-400">
                Yes, most titles include multiple audio tracks and subtitle languages, selectable directly
                from the player.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q4" className="border-neutral-800">
              <AccordionTrigger className="text-sm text-neutral-200">
                What's the difference between streaming and download links?
              </AccordionTrigger>
              <AccordionContent className="text-xs leading-relaxed text-neutral-400">
                Streaming/embed links load the full Moviepire player inside an iframe. Download links
                return direct file URLs for the available qualities, generated through the Movie, TV, or
                Anime forms above.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q5" className="border-neutral-800">
              <AccordionTrigger className="text-sm text-neutral-200">
                Do I need an API key to use Moviepire?
              </AccordionTrigger>
              <AccordionContent className="text-xs leading-relaxed text-neutral-400">
                No signup or API key is required. Just reference a TMDB or AniList ID in the URL patterns
                described in the API docs.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <div className="mt-10 flex flex-col items-center gap-3">
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-neutral-800 px-4 py-2.5 text-xs font-semibold text-neutral-300 transition hover:border-neutral-600 hover:text-white"
          >
            <Send className="h-3.5 w-3.5" />
            Join our Telegram Community
          </a>
          <p className="text-center text-[11px] text-neutral-600">
            Powered by TMDB &amp; AniList
          </p>
        </div>
      </main>
    </div>
  );
}
