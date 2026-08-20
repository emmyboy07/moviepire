import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

const SITE_URL = "https://video.moviepire.co";
const SITE_NAME = "Moviepire";
const SITE_TITLE = "Moviepire — Free Movie & TV Streaming API + Player";
const SITE_DESCRIPTION =
  "Moviepire is a free streaming link provider for movies, TV shows, and anime. Test the embeddable player live, grab instant streaming/embed links, or generate direct download links by TMDB or AniList ID.";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      {
        name: "keywords",
        content:
          "moviepire, movie streaming api, tv streaming api, embed player, tmdb streaming, video embed, stream test, movie download links, anime streaming",
      },
      { name: "author", content: SITE_NAME },
      { name: "robots", content: "index, follow" },
      { name: "theme-color", content: "#a855f7" },

      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: `${SITE_URL}/og-image.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },

      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: `${SITE_URL}/og-image.png` },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "canonical", href: SITE_URL },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE_NAME,
          url: SITE_URL,
          description: SITE_DESCRIPTION,
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-JRXZBJLJK5"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', 'G-JRXZBJLJK5'); (function(){ const _pushState = history.pushState; const _replaceState = history.replaceState; history.pushState = function(){ const ret = _pushState.apply(this, arguments); gtag('config', 'G-JRXZBJLJK5', { page_path: location.pathname + location.search }); return ret; }; history.replaceState = function(){ const ret = _replaceState.apply(this, arguments); gtag('config', 'G-JRXZBJLJK5', { page_path: location.pathname + location.search }); return ret; }; window.addEventListener('popstate', function(){ gtag('config', 'G-JRXZBJLJK5', { page_path: location.pathname + location.search }); }); })();`
          }}
        />
        <script data-cfasync="false" async type="text/javascript" src="//ae.muggurssalited.com/rE34FhA5am8/104823"></script>
        <script data-cfasync="false" async type="text/javascript" src="//bt.caulireid.com/s8bLeIgmLMoKKTM/131839"></script>
        <HeadContent />
        {/* Unregister any stale service workers (e.g. from playerjs) that cause CORS errors */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(regs){regs.forEach(function(r){r.unregister()})})}`
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function useSiteScripts() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // --- Histats analytics ---
    if (!document.getElementById("histats-js")) {
      (window as any)._Hasync = (window as any)._Hasync || [];
      (window as any)._Hasync.push(["Histats.start", "1,5034319,4,0,0,0,00010000"]);
      (window as any)._Hasync.push(["Histats.fasi", "1"]);
      (window as any)._Hasync.push(["Histats.track_hits", ""]);
      const hs = document.createElement("script");
      hs.id = "histats-js";
      hs.type = "text/javascript";
      hs.async = true;
      hs.src = "//s10.histats.com/js15_as.js";
      (document.getElementsByTagName("head")[0] || document.body).appendChild(hs);
    }

    // --- Click-based ad rotator ---
    const adNetworks = [
      {
        name: "profiton",
        load() {
          const s = document.createElement("script");
          s.setAttribute("data-cfasync", "false");
          s.async = true;
          s.type = "text/javascript";
          s.src = "//wn.opalsmeer.com/rgKxcE2BEL728X/104823";
          document.body.appendChild(s);
        },
      },
      {
        name: "monetag",
        load() {
          const s = document.createElement("script");
          s.dataset.zone = "9848529";
          s.src = "https://llvpn.com/tag.min.js";
          document.body.appendChild(s);
        },
      },
      {
        name: "hilltopads",
        load() {
          const d = document;
          const s = d.createElement("script");
          const l = d.scripts[d.scripts.length - 1];
          (s as any).settings = {};
          s.src = "//everlasting-inflation.com/c.D/9/6/bu2Z5_l/SZWXQd9XN/j/EW1dNGTGA/5/M/C/0_2RMGTgUY1mM/DekmxE";
          s.async = true;
          s.referrerPolicy = "no-referrer-when-downgrade";
          l.parentNode!.insertBefore(s, l);
        },
      },
      {
        name: "adsterra",
        load() {
          const s = document.createElement("script");
          s.src = "https://crowdsynonym.com/35/ac/7d/35ac7d2b3e561b16a4ad2c542e88689f.js";
          document.body.appendChild(s);
        },
      },
    ];

    const COOLDOWN = 10000; // 10 seconds
    let currentIndex = parseInt(localStorage.getItem("adIndex") || "0");
    let lastFired = parseInt(localStorage.getItem("adLastFired") || "0");
    let hasClicked = false;

    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("button, input, select, textarea")) {
        return;
      }
      if (!hasClicked) {
        hasClicked = true;
        return;
      }
      const now = Date.now();
      if (now - lastFired < COOLDOWN) return;

      adNetworks[currentIndex].load();
      lastFired = now;
      currentIndex = (currentIndex + 1) % adNetworks.length;
      localStorage.setItem("adLastFired", String(lastFired));
      localStorage.setItem("adIndex", String(currentIndex));
    };

    document.addEventListener("click", handler);
  }, []);
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useSiteScripts();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
