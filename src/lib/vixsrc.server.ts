"use server";

import { signHlsProxySession } from "./security.middleware";
import { envOr } from "./config.server";

const MAIN_URL = envOr(process.env.VIXSRC_BASE_URL, "https://vixsrc.to");
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface VixSrcResult {
  url: string;
  headers: Record<string, string>;
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

function extractRegex(text: string, pattern: string): string | null {
  const regex = new RegExp(pattern, "s");
  const match = regex.exec(text);
  return match?.[1] ?? null;
}

async function vixFetch(url: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${MAIN_URL}/`,
      ...extraHeaders,
    },
    redirect: "follow",
    signal: timeoutSignal(15000),
  });
}

export async function extractVixSrcStream({
  type,
  id,
  season,
  episode,
  language = "en",
}: {
  type: "movie" | "tv";
  id: string;
  season?: number;
  episode?: number;
  language?: string;
}): Promise<VixSrcResult | null> {
  try {
    let apiPath: string;
    if (type === "movie") {
      apiPath = `api/movie/${id}`;
    } else if (type === "tv" && season != null && episode != null) {
      apiPath = `api/tv/${id}/${season}/${episode}`;
    } else {
      return null;
    }

    apiPath += `?lang=${language}`;
    const apiUrl = `${MAIN_URL}/${apiPath}`;

    let apiResponse = await vixFetch(apiUrl, {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
    });

    if (!apiResponse.ok) return null;

    const apiData = (await apiResponse.json()) as { src?: string };
    const rawEmbedUrl = apiData.src?.trim();
    if (!rawEmbedUrl) return null;

    const embedUrl = new URL(rawEmbedUrl, `${MAIN_URL}/`);
    let playerUrl = embedUrl.toString();
    let playerResponse = await vixFetch(playerUrl, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "X-Requested-With": "XMLHttpRequest",
    });

    if (playerResponse.status === 410) {
      const retryApiResponse = await vixFetch(apiUrl, {
        Accept: "application/json, text/plain, */*",
      });
      const retryData = (await retryApiResponse.json()) as { src?: string };
      const retrySrc = retryData.src?.trim();
      if (retrySrc) {
        playerUrl = new URL(retrySrc, `${MAIN_URL}/`).toString();
        playerResponse = await vixFetch(playerUrl, { Accept: "text/html,*/*" });
      }
    }

    if (!playerResponse.ok) return null;

    const html = await playerResponse.text();

    // The API now includes these values in the embed URL query string. Read
    // them from there first, then fall back to the inline player config for
    // older Alpha responses.
    const videoIdFromUrl = embedUrl.pathname.match(/\/embed\/([^/]+)/)?.[1] ?? null;
    const videoId = videoIdFromUrl ?? extractRegex(html, `window\\.video\\s*=\\s*\\{[^}]*id:\\s*['"]([^'"]+)['"]`);
    const token = embedUrl.searchParams.get("token") ?? extractRegex(
      html,
      `window\\.masterPlaylist[^}]*(?:['"]token['"]|\\btoken\\b)\\s*:\\s*['"]([^'"]+)['"]`,
    );
    const expires = embedUrl.searchParams.get("expires") ?? extractRegex(
      html,
      `window\\.masterPlaylist[^}]*(?:['"]expires['"]|\\bexpires\\b)\\s*:\\s*['"]([^'"]+)['"]`,
    );

    const hasBParam = /url:[^,]*b=1/.test(html);
    const canPlayFHD = html.includes("window.canPlayFHD = true");

    if (!videoId || !token || !expires) return null;

    const params = new URLSearchParams({ token, expires, lang: language });
    if (hasBParam) params.set("b", "1");
    if (canPlayFHD) params.set("h", "1");

    const finalPlaylistUrl = `${MAIN_URL}/playlist/${videoId}?${params.toString()}`;

    const headers = {
      Referer: playerUrl,
      "User-Agent": BROWSER_UA,
    };

    // One session sig covers this whole manifest fetch (this playlist and
    // every segment/sub-playlist/key it references) — /api/hls-proxy re-signs
    // nothing per-URL, it just re-checks this same (exp, sig) pair and enforces
    // a target-domain whitelist (see server.ts) to keep it from being an open
    // relay. Local proxy now, so no external Worker/Froxy involved at all.
    const { sig, exp } = await signHlsProxySession();
    const proxyUrl =
      `/api/hls-proxy?url=${encodeURIComponent(finalPlaylistUrl)}` +
      `&ref=${encodeURIComponent(playerUrl)}&exp=${exp}&sig=${encodeURIComponent(sig)}`;

    return { url: proxyUrl, headers };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[VixSrc]", msg);
    return null;
  }
}
