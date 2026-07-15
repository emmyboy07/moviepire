import "./lib/error-capture";

import crypto from "node:crypto";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  generateSessionToken,
  verifySessionToken,
  deriveClientKey,
  verifyRequestNonce,
  verifyHlsProxySession,
} from "./lib/security.middleware";
import { envOr } from "./lib/config.server";

// -- Process-level crash guards -------------------------------------------
// Bun terminates the process on an unhandled promise rejection or an uncaught
// exception, exactly like Node >= 15. A streaming proxy produces both
// routinely: when a viewer seeks, switches quality, or closes the tab, the
// Response body stream is cancelled and the upstream fetch's socket can reject
// during teardown with nothing awaiting it. One of those kills the container,
// Docker restarts it, RestartCount climbs, and Coolify eventually gives up.
//
// In Bun, standard Node 'process.on' listeners are not enough if Web API 
// listeners are present. We attach both styles and explicitly execute 
// event.preventDefault() to force Bun to maintain uptime.
const CRASH_GUARD_KEY = "__mediaCrashGuardsInstalled";
if (!(globalThis as Record<string, unknown>)[CRASH_GUARD_KEY]) {
  (globalThis as Record<string, unknown>)[CRASH_GUARD_KEY] = true;

  // Node-compatibility event fallback
  process.on("unhandledRejection", (reason) => {
    console.error("[server] Node unhandled rejection (suppressed):", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[server] Node uncaught exception (suppressed):", error);
  });

  // Native Web API hooks crucial for Bun runtime stream error suppression
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("unhandledrejection", (event) => {
      event.preventDefault(); // Prevents Bun from terminating the process
      console.error("[server] Bun unhandled rejection (suppressed):", event.reason);
    });

    globalThis.addEventListener("error", (event) => {
      event.preventDefault(); // Prevents Bun from terminating the process
      console.error("[server] Bun uncaught exception (suppressed):", event.error);
    });
  }
}

// ── CDN smart-link (CSL) resolution ─────────────────────────────────────────
// Some segment/manifest URLs are wrapped by an upstream anti-leech layer: the
// real edge is hidden behind obfuscated `_ctump`/`_ctuph`/`_ctutt` query params
// pointing at a per-region relay, rather than being directly fetchable at the
// URL's own host. Fetching the URL as-is (even with correct headers) gets a
// flat 403 from the disguised host. Params are obfuscated as: strip an 8-char
// hash prefix, URL-decode, ROT13, base64-decode. `_ctump` decodes to
// comma-separated `region:type@host` candidates; `_ctuph` decodes to the real
// upstream path (own querystring included). The relay itself additionally
// requires an `_s2` query param: md5(`{lastPathSegment},{_ver},{salt}`). salt
// "00" is the compiled-in fallback and works in production. Most VixSrc/Blaze
// URLs don't carry these params at all, in which case this is a no-op.
function rot13(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function bruDecode(str: string): string {
  const sub = str.substring(8);
  const urlDecoded = decodeURIComponent(sub);
  const rot13d = rot13(urlDecoded);
  return Buffer.from(rot13d, "base64").toString("utf8");
}

const CSL_SALT = "00";

function cslSign(targetUrl: string, salt: string): string {
  const u = new URL(targetUrl);
  const lastSegment = u.pathname.split("/").filter(Boolean).pop() ?? "";
  const ver = u.searchParams.get("_ver") ?? "";
  const raw = `${lastSegment},${ver},${salt}`;
  return crypto.createHash("md5").update(raw).digest("hex");
}

// Resolves an upstream URL through the CSL relay if it carries CSL params;
// otherwise returns it unchanged (the common case).
function resolveCslUrl(targetUrl: string): string {
  let parsed: URL;
  try { parsed = new URL(targetUrl); } catch { return targetUrl; }
  const ctump = parsed.searchParams.get("_ctump");
  const ctuph = parsed.searchParams.get("_ctuph");
  if (!ctump || !ctuph) return targetUrl;

  try {
    const domainConfigs = bruDecode(ctump).split(",").map((s) => s.trim()).filter(Boolean);
    const realPath = bruDecode(ctuph);
    for (const dc of domainConfigs) {
      const [, domainRaw] = dc.split("@");
      const domain = (domainRaw ?? "").trim();
      if (!domain) continue;
      const rawUrl = `https://${domain}${realPath}`;
      const signed = new URL(rawUrl);
      signed.searchParams.set("_s2", cslSign(rawUrl, CSL_SALT));
      return signed.toString();
    }
  } catch {
    // Fall through to the original URL if decoding fails for any reason.
  }
  return targetUrl;
}

// ── Optional residential proxy for segment fetches (Bun only) ───────────────
// Bun's fetch() supports an upstream proxy natively via the `proxy` option.
// Entirely inert (returns undefined) unless explicitly turned on - safe to
// leave configured-off by default. Only ever used for non-manifest byte
// fetches in /api/proxy-stream (full mp4 files / HLS segments), never for
// resolution calls, which now always go out directly.
const FROXY_USER = process.env.FROXY_USER;
const FROXY_PASS = process.env.FROXY_PASS;
const FROXY_HOST = process.env.FROXY_HOST || "fast.froxy.com";
const FROXY_PORT_MIN = Number(process.env.FROXY_PORT_MIN || 10000);
const FROXY_PORT_MAX = Number(process.env.FROXY_PORT_MAX || 10999);
const FROXY_ENABLED = process.env.USE_FROXY === "true" && !!FROXY_USER && !!FROXY_PASS;

function pickFroxyProxyUrl(): string | undefined {
  if (!FROXY_ENABLED) return undefined;
  const port = FROXY_PORT_MIN + Math.floor(Math.random() * (FROXY_PORT_MAX - FROXY_PORT_MIN + 1));
  return `http://${FROXY_USER}:${FROXY_PASS}@${FROXY_HOST}:${port}`;
}

// ── Segment cache + in-flight coalescing ─────────────────────────────────────
// Live segments are only valid for a few seconds, so a long cache is
// pointless - but many viewers of the same stream request the same segment
// within a tiny window. Without this, N viewers = N origin fetches.
type CachedSegment = { body: Uint8Array; headers: Record<string, string>; status: number; expires: number };
const segmentCache = new Map<string, CachedSegment>();
const inFlightSegmentFetches = new Map<string, Promise<CachedSegment>>();
const SEGMENT_CACHE_TTL_MS = 6_000; // roughly one segment duration
const SEGMENT_CACHE_MAX_ENTRIES = 500;

function pruneSegmentCache() {
  if (segmentCache.size <= SEGMENT_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, val] of segmentCache) {
    if (val.expires < now) segmentCache.delete(key);
  }
}

// Resolve a URL (possibly relative) against a base URL, returning an absolute URL string
function resolveUrl(uri: string, base: URL): string {
  try {
    if (uri.startsWith("http://") || uri.startsWith("https://")) return uri;
    if (uri.startsWith("//")) return `${base.protocol}${uri}`;
    if (uri.startsWith("/")) return `${base.protocol}//${base.host}${uri}`;
    const baseDir = base.href.substring(0, base.href.lastIndexOf("/") + 1);
    return baseDir + uri;
  } catch {
    return uri;
  }
}

// Returns all language aliases for a given ISO 639-1 code (used for HLS audio track matching)
function hlsLangVariants(lang: string): string[] {
  const map: Record<string, string[]> = {
    en: ["en", "eng", "english"],
    hi: ["hi", "hin", "hindi"],
    es: ["es", "spa", "spanish", "español"],
    fr: ["fr", "fra", "fre", "french"],
    de: ["de", "deu", "ger", "german"],
    pt: ["pt", "por", "portuguese"],
    ru: ["ru", "rus", "russian"],
    ja: ["ja", "jpn", "japanese"],
    ko: ["ko", "kor", "korean"],
    zh: ["zh", "chi", "zho", "chinese"],
    ar: ["ar", "ara", "arabic"],
    tr: ["tr", "tur", "turkish"],
    pl: ["pl", "pol", "polish"],
    nl: ["nl", "dut", "nld", "dutch"],
  };
  const reverse: Record<string, string> = {};
  for (const [code, aliases] of Object.entries(map)) {
    for (const a of aliases) reverse[a] = code;
  }
  const canonical = reverse[lang.toLowerCase()] ?? lang.toLowerCase();
  return map[canonical] ?? [canonical];
}

// HTTP header values must be Latin-1/ASCII (the Fetch API throws
// "Cannot convert argument to a ByteString" otherwise), but subtitle/title
// text routinely isn't - CDN language labels come through in native script
// and movie titles can contain accented or non-Latin characters too. RFC
// 5987's filename*=UTF-8'' syntax carries the real name for browsers that
// understand it (all modern ones), alongside a plain ASCII-safe filename=
// for anything that doesn't.
function buildContentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_") || "download";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// VixSrc /api/hls-proxy domain whitelist. Configurable via VIXSRC_ALLOWED_HOSTS
// (comma-separated) so it can be widened without a redeploy if vixsrc.to ever
// moves its segment CDN to a new host; defaults to the two hosts observed in
// production.
function vixSrcAllowedHosts(): string[] {
  return envOr(process.env.VIXSRC_ALLOWED_HOSTS, "vixsrc.to,vix-content.net")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}

// Local streaming proxy: everything that used to go through the external
// Cloudflare Workers (alphaproxy / stream-box-proxy) now proxies through this
// server directly - /api/proxy-stream for Blaze mp4/HLS byte-streaming and
// /api/hls-proxy for Alpha (VixSrc) HLS, both fetching upstream with a plain
// fetch() (no Froxy) unless USE_FROXY is explicitly turned on.
async function handleProxyRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  // Behind the reverse proxy, request.url (and thus url.origin) reports the
  // internal plain-HTTP scheme even though the public site is HTTPS-only -
  // building rewritten manifest URLs from url.origin directly produces
  // http:// links that browsers silently block as mixed content on the
  // https:// page, breaking every rendition/segment the manifest points to.
  const isPublicHttps = request.headers.get("x-forwarded-proto") === "https" || url.protocol === "https:";
  const publicOrigin = `${isPublicHttps ? "https" : "http"}://${url.host}`;

  if (!url.pathname.startsWith("/api/proxy") && url.pathname !== "/api/hls-proxy") {
    return null;
  }

  // Handle image proxy
  if (url.pathname === "/api/proxy-image") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing url parameter" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: `Failed to fetch image: ${response.status}` }), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }

      const contentType = response.headers.get("content-type") || "image/jpeg";
      return new Response(response.body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Proxy error" }),
        { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } },
      );
    }
  }

  // Handle subtitle proxy and convert SRT to WebVTT if needed
  if (url.pathname === "/api/proxy-subtitle") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing url parameter" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: `Failed to fetch subtitle: ${response.status}` }), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }

      const text = await response.text();
      let finalContent = text;

      // WebVTT files usually start with WEBVTT (might have a BOM prefix)
      const isVtt = text.trim().startsWith("WEBVTT") || targetUrl.toLowerCase().endsWith(".vtt");

      if (!isVtt) {
        // SRT uses comma for millisecond separator (e.g. 00:00:01,000), WebVTT uses dot
        const timestampRegex = /(\d{2}:\d{2}:\d{2}),(\d{3})/g;
        const normalized = text.replace(/\r\n/g, "\n");
        const converted = normalized.replace(timestampRegex, "$1.$2");
        finalContent = "WEBVTT\n\n" + converted;
      }

      return new Response(finalContent, {
        status: 200,
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Proxy error" }),
        { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } },
      );
    }
  }

  // Serves a subtitle file for actual download (as opposed to /api/proxy-subtitle,
  // which converts SRT->VTT for the in-player <track> tag). Keeps the original
  // format and sets a real filename - the subtitle CDN itself sends no
  // Content-Disposition at all, so a direct link just downloads (or opens) as
  // the CDN's opaque hash filename.
  if (url.pathname === "/api/proxy-subtitle-download") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing url parameter" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: `Failed to fetch subtitle: ${response.status}` }), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }

      const targetPath = targetUrl.split("?")[0].toLowerCase();
      const ext = targetPath.endsWith(".vtt") ? "vtt" : "srt";
      const filenameParam = url.searchParams.get("filename");
      const fallbackName = targetPath.split("/").pop() || `subtitle.${ext}`;
      const safeFilename = (filenameParam || fallbackName).replace(/[\r\n"]/g, "");

      return new Response(response.body, {
        status: 200,
        headers: {
          "Content-Type": response.headers.get("content-type") || "application/x-subrip",
          "Content-Disposition": buildContentDisposition(safeFilename),
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Proxy error" }),
        { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } },
      );
    }
  }

  // Handle stream proxy to bypass CORS - this is what Blaze mp4 links and any
  // HLS manifests/segments route through.
  if (url.pathname === "/api/proxy-stream") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing url parameter" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      const refererParam = url.searchParams.get("referer");
      const refererOrigin = refererParam
        ? (() => { try { return new URL(refererParam).origin; } catch { return "https://example.com"; } })()
        : "https://example.com";
      const refererUrl = refererParam ?? "https://example.com/";
      const headers: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
        Referer: refererUrl,
        Origin: refererOrigin,
        Accept: "application/vnd.apple.mpegurl,application/x-mpegurl,video/mp2t,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        Connection: "keep-alive",
        DNT: "1",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
      };

      const range = request.headers.get("range");
      if (range) {
        headers["Range"] = range;
      }

      const targetPathForTiming = targetUrl.split("?")[0].toLowerCase();
      const looksLikeM3u8 = targetPathForTiming.endsWith(".m3u8");
      // A handful of KB HLS segment vs. an entire movie file (hundreds of MB to
      // several GB) requested whole via `Range: bytes=0-`. The segment-cache
      // branch below buffers the full upstream response into memory before
      // returning anything - fine for a segment, but a full movie can
      // legitimately take minutes to transfer, so it skips that buffering and
      // runs without a short fixed deadline instead.
      const isFullMediaFile = /\.(mp4|mkv|m4v|avi|mov|webm)$/.test(targetPathForTiming);

      // Manifests: a single bounded attempt - hls.js already retries failed
      // loads itself by issuing a fresh request to this same endpoint.
      // Segments: larger payloads legitimately take longer, so a more
      // generous timeout plus one retry, but only on a 5xx or network
      // error/timeout - never on a successful-but-maybe-truncated 2xx.
      // Full media files: no fixed deadline - transfer time scales with file
      // size and the client's own bandwidth, neither of which we control.
      const timeoutMs = looksLikeM3u8 ? 8_000 : 20_000;
      const maxAttempts = looksLikeM3u8 ? 1 : 2;
      const fetchWithRetry = async (): Promise<Response> => {
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const proxy = looksLikeM3u8 ? undefined : pickFroxyProxyUrl();
            const fetchInit = {
              headers,
              redirect: "follow" as const,
              ...(isFullMediaFile ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
              ...(proxy ? { proxy } : {}),
            } as RequestInit;
            const fetchUrl = resolveCslUrl(targetUrl);
            const r = await fetch(fetchUrl, fetchInit);
            if (r.status >= 500 && attempt < maxAttempts) { lastErr = new Error(`upstream ${r.status}`); continue; }
            return r;
          } catch (e) {
            lastErr = e;
          }
        }
        throw lastErr instanceof Error ? lastErr : new Error("Upstream fetch failed");
      };

      // Manifests always go live. Full media files stream straight through,
      // uncached and unbuffered. Segments get cached + coalesced so
      // concurrent viewers of the same stream share one origin fetch.
      let response: Response;
      if (looksLikeM3u8) {
        response = await fetchWithRetry();
      } else if (isFullMediaFile) {
        response = await fetchWithRetry();
      } else {
        const cacheKey = targetUrl;
        pruneSegmentCache();
        const cached = segmentCache.get(cacheKey);
        if (cached && cached.expires > Date.now()) {
          response = new Response(cached.body as BodyInit, { status: cached.status, headers: cached.headers });
        } else {
          let pending = inFlightSegmentFetches.get(cacheKey);
          if (!pending) {
            pending = (async (): Promise<CachedSegment> => {
              const r = await fetchWithRetry();
              const buf = new Uint8Array(await r.arrayBuffer());
              const hdrs: Record<string, string> = {};
              const ct = r.headers.get("content-type");
              if (ct) hdrs["content-type"] = ct;
              hdrs["content-length"] = String(buf.byteLength);
              const cr = r.headers.get("content-range");
              if (cr) hdrs["content-range"] = cr;
              const ar = r.headers.get("accept-ranges");
              if (ar) hdrs["accept-ranges"] = ar;
              const entry: CachedSegment = { body: buf, headers: hdrs, status: r.status, expires: Date.now() + SEGMENT_CACHE_TTL_MS };
              if (r.status === 200 && !range) segmentCache.set(cacheKey, entry);
              return entry;
            })();
            inFlightSegmentFetches.set(cacheKey, pending);
            pending.finally(() => inFlightSegmentFetches.delete(cacheKey));
          }
          const result = await pending;
          response = new Response(result.body as BodyInit, { status: result.status, headers: result.headers });
        }
      }

      const responseHeaders = new Headers();
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "*");

      // Some upstream CDNs send Content-Type: application/vnd.apple.mpegurl on
      // plainly-binary assets due to a bucket/object misconfiguration. Trusting
      // that header alone would run the binary through the manifest
      // text-rewriter below, corrupting it - the URL's own extension is the
      // more reliable signal, so known-binary extensions always win.
      const targetPath = targetUrl.split("?")[0].toLowerCase();
      const isKnownBinary = /\.(key|ts|aac|mp4|m4s|m4a|jpg|jpeg|png|webp|gif|vtt|srt)$/.test(targetPath);
      const contentType = response.headers.get("content-type") || "";
      const isM3u8 =
        !isKnownBinary &&
        (contentType.includes("mpegurl") ||
          contentType.includes("x-mpegURL") ||
          targetPath.endsWith(".m3u8"));

      if (isM3u8) {
        // Rewrite all segment/playlist URLs in the manifest so they go through
        // our proxy - this prevents HLS.js from making direct CDN requests
        // (which are CORS-blocked).
        const text = await response.text();
        const baseUrl = new URL(response.url || targetUrl);
        const refererSuffix = refererParam
          ? `&referer=${encodeURIComponent(refererParam)}`
          : "";
        const proxyBase = `${publicOrigin}/api/proxy-stream?url=`;

        const rewritten = text
          .split("\n")
          .map((line) => {
            const trimmed = line.trim();

            if (trimmed.startsWith("#")) {
              return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
                const absolute = resolveUrl(uri, baseUrl);
                return `URI="${proxyBase}${encodeURIComponent(absolute)}${refererSuffix}"`;
              });
            }

            if (trimmed.length > 0) {
              const absolute = resolveUrl(trimmed, baseUrl);
              return `${proxyBase}${encodeURIComponent(absolute)}${refererSuffix}`;
            }

            return line;
          })
          .join("\n");

        responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
        return new Response(rewritten, {
          status: 200,
          headers: responseHeaders,
        });
      }

      const copyHeader = (name: string) => {
        const val = response.headers.get(name);
        if (val) responseHeaders.set(name, val);
      };

      copyHeader("content-type");
      copyHeader("content-length");
      copyHeader("content-range");
      copyHeader("accept-ranges");
      copyHeader("cache-control");

      // Force a real download instead of the browser just playing the video
      // inline - <video>/<audio> element fetches ignore Content-Disposition
      // entirely, so this doesn't affect in-page playback.
      if (isFullMediaFile) {
        const filenameParam = url.searchParams.get("filename");
        const fallbackName = targetPath.split("/").pop() || "video.mp4";
        const safeFilename = (filenameParam || fallbackName).replace(/[\r\n"]/g, "");
        responseHeaders.set("Content-Disposition", buildContentDisposition(safeFilename));
      }

      // Cloudflare (and similar CDNs/proxies in front of the deployed origin)
      // auto-compresses responses whenever the client's Accept-Encoding allows
      // it, regardless of content-type - re-compressing an already-compressed
      // MP4 achieves nothing but switches the response to
      // Transfer-Encoding: chunked and DROPS Content-Length/Accept-Ranges
      // entirely (confirmed directly against media-go-getter-main's identical
      // proxy: a browser-like Accept-Encoding got Content-Encoding: zstd with
      // no Content-Length at all, vs. a correct response without it). Every
      // real browser download hit this - only plain curl requests (which
      // don't request compression by default) looked fine. no-transform is
      // the standard signal telling any compliant intermediary not to alter
      // the response's encoding.
      const existingCacheControl = responseHeaders.get("cache-control");
      responseHeaders.set(
        "Cache-Control",
        existingCacheControl ? `${existingCacheControl}, no-transform` : "no-transform",
      );

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Proxy error" }),
        { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } },
      );
    }
  }

  // ── /api/hls-proxy — HMAC-authenticated HLS proxy for VixSrc streams ─────────
  if (url.pathname === "/api/hls-proxy") {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    const targetUrl = url.searchParams.get("url");
    const referer = url.searchParams.get("ref") ?? "";
    const exp = url.searchParams.get("exp") ?? "";
    const sig = url.searchParams.get("sig") ?? "";

    if (!targetUrl || !exp || !sig) {
      return new Response(JSON.stringify({ error: "Missing required params" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // Verify HMAC session signature
    const valid = await verifyHlsProxySession(exp, sig);
    if (!valid) {
      return new Response(JSON.stringify({ error: "Invalid or expired proxy token" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }

    // Domain whitelist — only proxy VixSrc URLs
    let parsedTarget: URL;
    try {
      parsedTarget = new URL(targetUrl);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const allowed = vixSrcAllowedHosts().some(
      (host) => parsedTarget.hostname === host || parsedTarget.hostname.endsWith(`.${host}`),
    );
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Domain not allowed" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }

    try {
      const fetchHeaders: Record<string, string> = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/vnd.apple.mpegurl,application/x-mpegurl,video/mp2t,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        Connection: "keep-alive",
      };
      if (referer) {
        fetchHeaders["Referer"] = referer;
        try { fetchHeaders["Origin"] = new URL(referer).origin; } catch {}
      }
      const range = request.headers.get("range");
      if (range) fetchHeaders["Range"] = range;

      const upstream = await fetch(targetUrl, { headers: fetchHeaders, redirect: "follow" });

      const responseHeaders = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });

      // Upstream errors (403/429/5xx block pages, etc.) must not be wrapped
      // as if they were a valid manifest/segment - forward the real status so
      // the player sees an actual HTTP error instead of an unparsable "200".
      if (!upstream.ok) {
        return new Response(await upstream.text(), { status: upstream.status, headers: responseHeaders });
      }

      const contentType = upstream.headers.get("content-type") ?? "";
      const isM3u8 =
        contentType.includes("mpegurl") ||
        contentType.includes("x-mpegURL") ||
        targetUrl.includes(".m3u8") ||
        targetUrl.includes("/playlist/");

      if (isM3u8) {
        const text = await upstream.text();
        const baseUrl = parsedTarget;
        const proxyBase = `${publicOrigin}/api/hls-proxy`;
        // Reuse the same sig+exp for all URLs rewritten in this manifest
        const sessionParams = `&ref=${encodeURIComponent(referer)}&exp=${exp}&sig=${encodeURIComponent(sig)}`;

        // Detect language from ref query param (passed as ?lang=xx on the playlist URL)
        const langCode = parsedTarget.searchParams.get("lang") ?? "en";

        const rewritten = text
          .split("\n")
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            if (trimmed.startsWith("#")) {
              // Drop subtitle renditions — player handles its own subs
              if (trimmed.startsWith("#EXT-X-MEDIA") && trimmed.includes("TYPE=SUBTITLES")) {
                return null;
              }

              // Set default audio track matching the requested language
              let patched = trimmed;
              if (patched.startsWith("#EXT-X-MEDIA:TYPE=AUDIO")) {
                patched = patched
                  .replace(/DEFAULT=YES/gi, "DEFAULT=NO")
                  .replace(/AUTOSELECT=YES/gi, "AUTOSELECT=NO");

                const l = patched.toLowerCase();
                const langVariants = hlsLangVariants(langCode);
                const isMatch = langVariants.some(
                  (v) => l.includes(`language="${v}"`) || l.includes(`name="${v}"`),
                );
                if (isMatch) {
                  patched = patched.replace("DEFAULT=NO", "DEFAULT=YES").replace("AUTOSELECT=NO", "AUTOSELECT=YES");
                }
              }

              // Strip SUBTITLES= from EXT-X-STREAM-INF
              if (patched.startsWith("#EXT-X-STREAM-INF") && patched.includes("SUBTITLES=")) {
                patched = patched.replace(/,?SUBTITLES="[^"]*"/, "");
              }

              // Rewrite URI="..." attributes
              patched = patched.replace(/URI="([^"]+)"/g, (_m, uri) => {
                const abs = resolveUrl(uri, baseUrl);
                return `URI="${proxyBase}?url=${encodeURIComponent(abs)}${sessionParams}"`;
              });

              return patched;
            }

            // Segment / sub-playlist URL
            const abs = resolveUrl(trimmed, baseUrl);
            return `${proxyBase}?url=${encodeURIComponent(abs)}${sessionParams}`;
          })
          .filter((l) => l !== null)
          .join("\n");

        responseHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
        return new Response(rewritten, { status: 200, headers: responseHeaders });
      }

      // Segment passthrough
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"]) {
        const v = upstream.headers.get(h);
        if (v) responseHeaders.set(h, v);
      }
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : "Proxy error" }),
        { status: 500, headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" } },
      );
    }
  }

  return null;
}

const SERVER_STARTED_AT = Date.now();

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}


async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:8080",
  "http://localhost:3000",
  "https://streambox-scrapper.vercel.app",
  "https://sonixhub.vercel.app",
]);

function getAllowedOrigins(): Set<string> {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) {
    const extras = env.split(",").map((o) => o.trim()).filter(Boolean);
    return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extras]);
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function getCorsOrigin(requestOrigin: string | null): string {
  if (requestOrigin && getAllowedOrigins().has(requestOrigin)) {
    return requestOrigin;
  }
  return "https://streambox-scrapper.vercel.app";
}

function addCorsHeaders(response: Response, requestOrigin: string | null): Response {
  const newResponse = new Response(response.body, response);
  const origin = getCorsOrigin(requestOrigin);
  newResponse.headers.set("Access-Control-Allow-Origin", origin);
  newResponse.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  newResponse.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-request-nonce");
  newResponse.headers.set("Access-Control-Allow-Credentials", "true");
  newResponse.headers.set("Vary", "Origin");
  return newResponse;
}

function parseCookies(cookieStr: string | null): Record<string, string> {
  if (!cookieStr) return {};
  return Object.fromEntries(
    cookieStr.split(";").map((c) => {
      const parts = c.trim().split("=");
      return [parts[0], parts.slice(1).join("=")];
    })
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Cheap liveness probe. No dependencies, no upstream calls -- it answers
      // as long as the event loop is turning. Point Coolify's healthcheck here
      // so container health stops reporting "(unknown)".
      if (new URL(request.url).pathname === "/health") {
        return new Response(
          JSON.stringify({
            ok: true,
            uptimeSeconds: Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        );
      }

      if (request.method === "OPTIONS") {
        const reqOrigin = request.headers.get("origin");
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": getCorsOrigin(reqOrigin),
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, x-request-nonce",
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
          },
        });
      }

      // Streaming proxy routes (/api/proxy-*, /api/hls-proxy) are public,
      // directly-fetched-by-the-player endpoints - hls.js/<video> can't attach
      // the session cookie's nonce header, so these are handled before (and
      // are exempt from) the server-function session/nonce gate below. Each
      // route does its own authorization (HMAC session sig + domain whitelist
      // for /api/hls-proxy; nothing sensitive is exposed by the others).
      const proxyResponse = await handleProxyRequest(request);
      if (proxyResponse) {
        return proxyResponse;
      }

      const cookieHeader = request.headers.get("cookie");
      const cookies = parseCookies(cookieHeader);
      const sessionToken = cookies["media_session"];
      const userAgent = request.headers.get("user-agent") ?? "";
      const requestOrigin = request.headers.get("origin");

      const isServerFnRequest = request.url.includes("/_serverFn/");

      if (isServerFnRequest) {
        if (!sessionToken || !(await verifySessionToken(sessionToken, userAgent))) {
          return new Response(JSON.stringify({ error: "Forbidden: Invalid or expired session" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }

        const nonce = request.headers.get("x-request-nonce");
        if (!nonce || !(await verifyRequestNonce(nonce, sessionToken))) {
          return new Response(JSON.stringify({ error: "Forbidden: Invalid or expired request nonce" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }
      }

      let newSessionToken: string | null = null;
      let newClientKey: string | null = null;
      let clientKeyForInjection: string | null = null;

      const isHttps =
        request.url.startsWith("https://") ||
        request.headers.get("x-forwarded-proto") === "https";
      // `Partitioned` (CHIPS) is required in addition to `SameSite=None; Secure`
      // for this cookie to survive when the page is loaded in a cross-site
      // iframe (e.g. embedded on movienova.co). Chrome partitions third-party
      // cookies by top-level site and drops unpartitioned SameSite=None cookies
      // in that context - without this flag the session cookie never round-trips
      // back to the server from inside someone else's iframe, so every
      // server-function call fails verifySessionToken() with a 403, which the
      // player surfaces as a generic "Failed to load movie".
      // Non-HTTPS (local dev) can't use SameSite=None/Partitioned at all, so it
      // falls back to Lax there - iframe embedding just won't work over plain HTTP.
      const sameSiteFlag = isHttps ? "SameSite=None; Secure; Partitioned" : "SameSite=Lax";

      const isPageRequest =
        request.method === "GET" &&
        !request.url.includes("/_serverFn/") &&
        !request.url.includes("/api/");

      if (isPageRequest) {
        if (!sessionToken || !(await verifySessionToken(sessionToken, userAgent))) {
          newSessionToken = await generateSessionToken(userAgent);
          newClientKey = await deriveClientKey(newSessionToken);
          clientKeyForInjection = newClientKey;
        } else {
          clientKeyForInjection = await deriveClientKey(sessionToken);
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);

      if (isPageRequest && clientKeyForInjection) {
        const contentType = normalized.headers.get("content-type") ?? "";
        if (contentType.includes("text/html")) {
          const html = await normalized.text();
          const keyScript = `<script>window.__MEDIA_CLIENT_KEY__="${clientKeyForInjection}"</script>`;
          const injectedHtml = html.includes("</head>")
            ? html.replace("</head>", `${keyScript}</head>`)
            : keyScript + html;

          const newHeaders = new Headers(normalized.headers);
          newHeaders.set("content-type", "text/html; charset=utf-8");
          if (newSessionToken && newClientKey) {
            newHeaders.append(
              "Set-Cookie",
              `media_session=${newSessionToken}; Path=/; HttpOnly; ${sameSiteFlag}; Max-Age=86400`,
            );
            newHeaders.append(
              "Set-Cookie",
              `media_client_key=${newClientKey}; Path=/; ${sameSiteFlag}; Max-Age=86400`,
            );
          }
          return addCorsHeaders(
            new Response(injectedHtml, { status: normalized.status, headers: newHeaders }),
            requestOrigin,
          );
        }
      }

      const finalResponse = addCorsHeaders(normalized, requestOrigin);

      if (newSessionToken && newClientKey) {
        const updatedResponse = new Response(finalResponse.body, finalResponse);
        updatedResponse.headers.append(
          "Set-Cookie",
          `media_session=${newSessionToken}; Path=/; HttpOnly; ${sameSiteFlag}; Max-Age=86400`,
        );
        updatedResponse.headers.append(
          "Set-Cookie",
          `media_client_key=${newClientKey}; Path=/; ${sameSiteFlag}; Max-Age=86400`,
        );
        return updatedResponse;
      }

      return finalResponse;
    } catch (error) {
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
