import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/product-doc')({
  head: () => ({
    meta: [
      { title: 'StreamBox Starter Kit — Buy Now' },
      { name: 'description', content: 'Buy StreamBox Starter Kit: a ready-made streaming dashboard with TMDB search, local PlayerJS playback, and download support.' },
    ],
  }),
  component: ProductDoc,
});

function ProductDoc() {
  return (
    <main className="mx-auto max-w-5xl p-6 sm:p-10">
      <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-10 shadow-2xl shadow-black/40">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <p className="mb-4 text-sm uppercase tracking-[0.3em] text-fuchsia-400">StreamBox Starter Kit</p>
            <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Ready-made streaming UI for movies, TV, and short dramas.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">
              Buy a complete React/TypeScript streaming dashboard with multiple quality options, multiple language and dub support, local PlayerJS playback, TMDB metadata search, StreamBox media matching, episode switching, and download-ready source handling.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <span className="rounded-full bg-fuchsia-500/10 px-4 py-2 text-sm font-semibold text-fuchsia-200 ring-1 ring-fuchsia-500/20">
              Purchase license today
            </span>
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-2xl bg-fuchsia-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-fuchsia-400"
            >
              Return to Home
            </Link>
          </div>
        </div>
      </div>

      <section className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-7 shadow-xl shadow-black/20">
          <h2 className="text-2xl font-semibold text-white">Why buy this kit?</h2>
          <p className="mt-4 text-slate-300">
            StreamBox Starter Kit is a fully assembled streaming app shell, so you avoid building the frontend, playback, and API integrations from scratch. It is ideal for launching a demo, MVP, or paid white-label product quickly.
          </p>
          <ul className="mt-5 space-y-3 text-slate-300">
            <li className="rounded-2xl bg-slate-900/80 p-3">Prebuilt streaming and download user flows.</li>
            <li className="rounded-2xl bg-slate-900/80 p-3">PlayerJS loads locally, not from a CDN.</li>
            <li className="rounded-2xl bg-slate-900/80 p-3">Short drama episode switching included.</li>
            <li className="rounded-2xl bg-slate-900/80 p-3">100% Ad-Free, white-label client streaming.</li>
          </ul>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-7 shadow-xl shadow-black/20">
          <h2 className="text-2xl font-semibold text-white">What you get</h2>
          <ul className="mt-4 space-y-3 text-slate-300">
            <li className="rounded-2xl bg-slate-900/80 p-3">TMDB ID search for movie and TV content.</li>
            <li className="rounded-2xl bg-slate-900/80 p-3">Multiple quality and language source selection.</li>
            <li className="rounded-2xl bg-slate-900/80 p-3">Download-ready source list with direct links.</li>
            <li className="rounded-2xl bg-slate-900/80 p-3">Local `playerjs.js` asset for reliable playback.</li>
            <li className="rounded-2xl bg-slate-900/80 p-3">`back` parameter integration for conditional back link routing.</li>
          </ul>
        </div>
      </section>

      <section className="mt-10 rounded-3xl border border-white/10 bg-white/5 p-7 shadow-xl shadow-black/20">
        <h2 className="text-2xl font-semibold text-white">Buy it if you need</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-900/80 p-4">
            <p className="font-semibold text-white">Fast MVP launch</p>
            <p className="mt-2 text-slate-300">Ship a working streaming dashboard in days instead of weeks.</p>
          </div>
          <div className="rounded-2xl bg-slate-900/80 p-4">
            <p className="font-semibold text-white">White-label streaming</p>
            <p className="mt-2 text-slate-300">Customize branding and deploy a polished product quickly.</p>
          </div>
          <div className="rounded-2xl bg-slate-900/80 p-4">
            <p className="font-semibold text-white">Local playback asset</p>
            <p className="mt-2 text-slate-300">Avoid CDN dependency by bundling `playerjs.js` directly.</p>
          </div>
          <div className="rounded-2xl bg-slate-900/80 p-4">
            <p className="font-semibold text-white">Short drama support</p>
            <p className="mt-2 text-slate-300">Built-in episode and season selection for short drama series.</p>
          </div>
        </div>
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300">
          <p className="text-sm uppercase tracking-[0.24em] text-fuchsia-400">Ready to buy</p>
          <h3 className="mt-4 text-xl font-semibold text-white">Purchase a complete starter kit</h3>
          <p className="mt-3 text-slate-300">Use the template to reduce development time and ship a streaming product faster.</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300">
          <p className="text-sm uppercase tracking-[0.24em] text-fuchsia-400">Why this matters</p>
          <h3 className="mt-4 text-xl font-semibold text-white">Avoid custom playback setup</h3>
          <p className="mt-3 text-slate-300">Most streaming apps fail in playback because they use unstable CDN scripts. This kit fixes that with a local player bundle.</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300">
          <p className="text-sm uppercase tracking-[0.24em] text-fuchsia-400">Buy with confidence</p>
          <h3 className="mt-4 text-xl font-semibold text-white">Fully functional starter app</h3>
          <p className="mt-3 text-slate-300">Inspect the code, reuse the logic, and launch a streaming front-end that already handles search, quality switching, and downloads.</p>
        </div>
      </section>

      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-400">
          Ready to own the StreamBox Starter Kit? Use this page as your sales pitch and ship a streaming product faster.
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
        >
          Back to Home
        </Link>
      </div>
    </main>
  );
}
