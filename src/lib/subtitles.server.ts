"use server";

const SUB_BASE = "https://sub.vdrk.site";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

export interface VdrkSubtitle {
  label: string;
  url: string;
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export async function extractVdrkSubtitles({
  type,
  tmdbId,
  season,
  episode,
}: {
  type: "movie" | "tv";
  tmdbId: string;
  season?: number;
  episode?: number;
}): Promise<VdrkSubtitle[]> {
  if (type === "tv" && (season == null || episode == null)) {
    throw new Error("Missing season/episode");
  }

  const path =
    type === "movie"
      ? `/v1/movie/${tmdbId}`
      : `/v1/tv/${tmdbId}/${season}/${episode}`;
  const apiUrl = `${SUB_BASE}${path}`;

  let resp: Response;
  try {
    resp = await fetch(apiUrl, {
      headers: {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: "https://cinemaos.live",
        Referer: "https://cinemaos.live/",
        "User-Agent": BROWSER_UA,
      },
      signal: timeoutSignal(10000),
    });
  } catch (e) {
    throw new Error(
      `Vdrk subtitle fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!resp.ok) throw new Error(`Vdrk subtitle API HTTP ${resp.status}`);

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    throw new Error("Vdrk subtitle response not JSON");
  }
  if (!Array.isArray(data))
    throw new Error("Vdrk subtitle response not an array");

  return data
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      label: String(s.label ?? "Subtitle"),
      url: String(s.file ?? ""),
    }))
    .filter((s) => s.url.length > 0);
}
