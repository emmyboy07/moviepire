import { createFileRoute, Link } from "@tanstack/react-router";
import { Play, ArrowLeft, Code, Layers, Settings, Globe, Download, Server } from "lucide-react";

export const Route = createFileRoute("/api-doc")({
  head: () => ({
    meta: [
      { title: "API Integration Docs — Moviepire" },
      { name: "description", content: "Developer guide to integrating Moviepire embeds and download dashboards." },
    ],
  }),
  component: ApiDocPage,
});

function ApiDocPage() {
  return (
    <div className="relative min-h-screen bg-[#07070b] text-white">
      {/* Background radial glow */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-br from-indigo-950/20 via-[#07070b] to-fuchsia-950/20" />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(120,80,255,0.1),transparent_60%)]" />

      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 transition hover:opacity-90">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-indigo-500 shadow-lg shadow-fuchsia-500/30">
              <Play className="h-4 w-4 fill-white text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">Moviepire</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
                Developer API
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-4 text-xs">
            <Link
              to="/"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              Search Panel
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-20 pt-10">
        <div className="space-y-12">
          {/* Header */}
          <div className="space-y-4">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/50 transition hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Dashboard
            </Link>
            <h2 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Developer Integration API Docs
            </h2>
            <p className="max-w-3xl text-sm leading-relaxed text-white/60">
              Integrate Moviepire directly into your website or application using our clean, customizable embeds and structured download dashboards. Movie and TV Show endpoints utilize TMDB IDs (requires TMDB API key to be set in your server config). Anime endpoints utilize AniList IDs and work keyless out of the box without requiring any API keys.
            </p>
          </div>

          <hr className="border-white/5" />

          {/* Section 1: Streaming Embeds */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20">
                <Code className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-2xl font-bold">1. Streaming Video Embeds</h3>
                <p className="text-xs text-white/40">Exposes a zero-chrome, full-screen player optimized for iframe insertion.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-fuchsia-400">Movie Embed URL</p>
                <code className="block rounded bg-black/40 p-3 text-xs text-indigo-200 break-all select-all">
                  /embed/movie/{"{tmdb_id}"}
                </code>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-fuchsia-400">TV Show Embed URL</p>
                <code className="block rounded bg-black/40 p-3 text-xs text-indigo-200 break-all select-all">
                  /embed/tv/{"{tmdb_id}"}/{"{season}"}/{"{episode}"}
                </code>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-fuchsia-400">Anime Embed URL</p>
                <code className="block rounded bg-black/40 p-3 text-xs text-indigo-200 break-all select-all">
                  /stream/anime/{"{anilist_id}"}/{"{episode}"}
                </code>
              </div>
            </div>

            {/* Custom Parameters Table */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold uppercase tracking-wider text-white/80">Query Parameters</h4>
              <p className="text-xs text-white/50">Append these search parameters to customize the behavior and design of the embed player:</p>
              
              <div className="overflow-hidden rounded-xl border border-white/5 bg-white/[0.01]">
                <div className="grid grid-cols-12 gap-4 border-b border-white/5 bg-black/20 p-4 text-[10px] font-bold uppercase tracking-widest text-white/40">
                  <div className="col-span-3">Parameter</div>
                  <div className="col-span-2">Type</div>
                  <div className="col-span-2">Default</div>
                  <div className="col-span-5">Description</div>
                </div>
                <div className="divide-y divide-white/5 text-xs">
                  <div className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-semibold text-fuchsia-300">`logo`</div>
                    <div className="col-span-2 text-white/60">`String (URL)`</div>
                    <div className="col-span-2 text-white/40">`null`</div>
                    <div className="col-span-5 text-white/70">Custom image URL to display as a watermark logo in the top-right corner of the player.</div>
                  </div>
                  <div className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-semibold text-fuchsia-300">`color`</div>
                    <div className="col-span-2 text-white/60">`String (Hex)`</div>
                    <div className="col-span-2 text-white/40">`d946ef`</div>
                    <div className="col-span-5 text-white/70">Accent color code (without `#`) for the loader spinner, timeline, volume sliders, etc. (e.g. `3b82f6`).</div>
                  </div>
                  <div className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-semibold text-fuchsia-300">`download`</div>
                    <div className="col-span-2 text-white/60">`Boolean`</div>
                    <div className="col-span-2 text-white/40">`true`</div>
                    <div className="col-span-5 text-white/70">Pass `download=false` to hide the download options button in the player control bar.</div>
                  </div>
                  <div className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-semibold text-fuchsia-300">`autoplay`</div>
                    <div className="col-span-2 text-white/60">`Boolean`</div>
                    <div className="col-span-2 text-white/40">`true`</div>
                    <div className="col-span-5 text-white/70">Pass `autoplay=false` to disable auto-start playback when the player loads.</div>
                  </div>
                  <div className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-semibold text-fuchsia-300">`title`</div>
                    <div className="col-span-2 text-white/60">`String`</div>
                    <div className="col-span-2 text-white/40">`TMDB Title`</div>
                    <div className="col-span-5 text-white/70">Custom text override to display as the movie or show title in the top-left player bar.</div>
                  </div>
                  <div className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-semibold text-fuchsia-300">`back`</div>
                    <div className="col-span-2 text-white/60">`String (URL)`</div>
                    <div className="col-span-2 text-white/40">`null`</div>
                    <div className="col-span-5 text-white/70">URL path for the back button. When provided, a back navigation button appears linking to this path.</div>
                  </div>
                  <div className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-semibold text-fuchsia-300">`server`</div>
                    <div className="col-span-2 text-white/60">`String (Enum)`</div>
                    <div className="col-span-2 text-white/40">`auto`</div>
                    <div className="col-span-5 text-white/70">Force a specific streaming server. <code>alpha</code> =(HLS, EN+HI only). <code>blaze</code> = MP4 Gateway (multi-language). Omit to auto-select Alpha first, falling back to Blaze.</div>
                  </div>
                  <div className="grid grid-cols-12 gap-4 p-4 items-center">
                    <div className="col-span-3 font-semibold text-fuchsia-300">`para`</div>
                    <div className="col-span-2 text-white/60">`Boolean`</div>
                    <div className="col-span-2 text-white/40">`true`</div>
                    <div className="col-span-5 text-white/70">Controls visibility of the server indicator badge in the top-right corner of the player. Pass <code>para=false</code> to hide it.</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Example iframe snippet */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold uppercase tracking-wider text-white/80">HTML IFrame Example</h4>
              <div className="relative">
                <pre className="overflow-x-auto rounded-xl border border-white/5 bg-black/60 p-4 text-[11px] font-mono text-indigo-200">
{`<iframe
  src="/embed/movie/385687?color=3b82f6&download=false&server=alpha"
  width="100%"
  height="480px"
  frameborder="0"
  allowfullscreen>
</iframe>`}
                </pre>
              </div>
            </div>
          </section>

          {/* Server Capabilities */}
          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500/10 text-green-400 border border-green-500/20">
                <Server className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-xl font-bold">Streaming Servers</h3>
                <p className="text-xs text-white/40">Two servers are available, selectable via the <code className="text-fuchsia-300">server</code> param.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-green-400 uppercase tracking-widest">Alpha</p>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">HLS</span>
                </div>
                <ul className="text-xs text-white/60 space-y-1 list-disc list-inside">
                  <li>Stream format: HLS (.m3u8)</li>
                  <li>Supported languages: English, Hindi</li>
                  <li>Loaded first by default (auto-fallback if unavailable)</li>
                  <li>No MP4 download support</li>
                </ul>
                <code className="block rounded bg-black/40 p-2 text-[11px] text-indigo-200">server=alpha</code>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-indigo-400 uppercase tracking-widest">Blaze — MP4 Gateway</p>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">MP4</span>
                </div>
                <ul className="text-xs text-white/60 space-y-1 list-disc list-inside">
                  <li>Stream format: MP4 (direct link)</li>
                  <li>Multi-language support (EN, HI, ES, FR, DE, and more)</li>
                  <li>Multiple quality levels (1080p, 720p, 480p)</li>
                  <li>Fallback when Alpha is unavailable</li>
                </ul>
                <code className="block rounded bg-black/40 p-2 text-[11px] text-indigo-200">server=blaze</code>
              </div>
            </div>
          </section>

          <hr className="border-white/5" />

          {/* Section 2: Download Dashboards */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-2xl font-bold">2. Download Dashboards</h3>
                <p className="text-xs text-white/40">Directs users to a premium page showing TMDB summary and direct download source files.</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Movie Download Dashboard</p>
                <code className="block rounded bg-black/40 p-3 text-xs text-indigo-200 break-all select-all">
                  /download/movie/{"{tmdb_id}"}
                </code>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">TV Show Download Dashboard</p>
                <code className="block rounded bg-black/40 p-3 text-xs text-indigo-200 break-all select-all">
                  /download/tv/{"{tmdb_id}"}/{"{season}"}/{"{episode}"}
                </code>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-indigo-400">Anime Download Dashboard</p>
                <code className="block rounded bg-black/40 p-3 text-xs text-indigo-200 break-all select-all">
                  /download/anime/{"{anilist_id}"}/{"{episode}"}
                </code>
              </div>
            </div>

            {/* Explanatory Paragraphs */}
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-white/5 bg-white/[0.01] p-5 space-y-2.5">
                <div className="flex items-center gap-2 text-fuchsia-400 font-bold text-sm">
                  <Globe className="h-4 w-4" />
                  Real-time Media Sources
                </div>
                <p className="text-xs leading-relaxed text-white/60">
                  When a download page is loaded, the application uses TMDB/AniList metadata to lookup matches on our stream delivery gateway. Once resolved, it extracts all available download qualities (1080p, 720p, 480p, etc.), audio tracks, and formats (MP4, MKV) dynamically.
                </p>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.01] p-5 space-y-2.5">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                  <Download className="h-4 w-4" />
                  Dual Streaming + Language Selection
                </div>
                <p className="text-xs leading-relaxed text-white/60">
                  The dashboard features a dropdown to switch languages/dubs. When a language is selected, the server queries the Gateway's language index and repopulates the download sources list instantly. A direct "Stream Now" CTA links back to the embed player.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
