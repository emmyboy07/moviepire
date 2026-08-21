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
  const m = new RegExp(pattern, "s").exec(text);
  return m?.[1] ?? null;
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
}): Promise<VixSrcResult> {
  if (type === "tv" && (season == null || episode == null)) {
    throw new Error("Missing season/episode");
  }

  // Step 1: API → embed src
  let apiPath = type === "movie" ? `api/movie/${id}` : `api/tv/${id}/${season}/${episode}`;
  apiPath += `?lang=${language}`;
  const apiUrl = `${MAIN_URL}/${apiPath}`;

  let apiResp: Response;
  try {
    apiResp = await vixFetch(apiUrl, {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
    });
  } catch (e) {
    throw new Error(`API fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!apiResp.ok) {
    throw new Error(`API HTTP ${apiResp.status}`);
  }

  let apiData: { src?: string };
  try {
    apiData = await apiResp.json();
  } catch {
    throw new Error("API response not JSON");
  }

  const embedPath = apiData.src?.trim().replace(/^\//, "");
  if (!embedPath) {
    throw new Error(`No src in API response. Keys: ${Object.keys(apiData).join(",")}`);
  }

  const playerUrl = `${MAIN_URL}/${embedPath}`;

  // Step 2: Player page → extract tokens
  let playerResp: Response;
  try {
    playerResp = await vixFetch(playerUrl, {
      Accept: "text/html,application/xhtml+xml,*/*",
      "X-Requested-With": "XMLHttpRequest",
    });
  } catch (e) {
    throw new Error(`Player fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (playerResp.status === 410) {
    // Retry API once on 410
    try {
      const retry = await vixFetch(apiUrl, { Accept: "application/json, text/plain, */*" });
      const rd = (await retry.json()) as { src?: string };
      const rp = rd.src?.trim().replace(/^\//, "");
      if (rp) playerResp = await vixFetch(`${MAIN_URL}/${rp}`, { Accept: "text/html,*/*" });
    } catch (e) {
      throw new Error(`410 retry failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!playerResp.ok) throw new Error(`Player HTTP ${playerResp.status}`);

  const html = await playerResp.text();

  const videoId = extractRegex(html, `window\\.video\\s*=\\s*\\{[^}]*id:\\s*['"]([^'"]+)['"]`);
  const token = extractRegex(
    html,
    `window\\.masterPlaylist[^}]*(?:['"]token['"]|\\btoken\\b)\\s*:\\s*['"]([^'"]+)['"]`,
  );
  const expires = extractRegex(
    html,
    `window\\.masterPlaylist[^}]*(?:['"]expires['"]|\\bexpires\\b)\\s*:\\s*['"]([^'"]+)['"]`,
  );
  const hasBParam = /url:[^,]*b=1/.test(html);
  const canPlayFHD = html.includes("window.canPlayFHD = true");

  if (!videoId || !token || !expires) {
    const snippet = html.substring(0, 400).replace(/\n/g, " ");
    throw new Error(`Regex failed. videoId=${videoId} token=${!!token} expires=${!!expires}. Snippet: ${snippet}`);
  }

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
}
