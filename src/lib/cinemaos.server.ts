"use server";

const CINEMAOS_BASE = "https://pvrplay.online";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface CinemaosSource {
  id: string;
  scraperId: string;
  scraperName: string;
  label: string;
  quality: string;
  type: "dash" | "hls" | "mp4";
  speed: string | null;
  url: string;
  mirrors: string[];
  verified: boolean;
}

export interface CinemaosResult {
  sources: CinemaosSource[];
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

function toCinemaosSource(raw: unknown): CinemaosSource | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.url !== "string" || s.url.length === 0) return null;

  return {
    id: String(s.id ?? s.url),
    scraperId: String(s.scraperId ?? "unknown"),
    scraperName: String(s.scraperName ?? s.scraperId ?? "Unknown"),
    label: String(s.label ?? s.scraperName ?? "Source"),
    quality: String(s.quality ?? "Auto"),
    type: s.type === "dash" || s.type === "mp4" ? s.type : "hls",
    speed: typeof s.speed === "string" ? s.speed : null,
    url: s.url,
    mirrors: Array.isArray(s.mirrors)
      ? s.mirrors.filter((m): m is string => typeof m === "string")
      : [],
    verified: !!s.verified,
  };
}

export async function extractCinemaosStreams({
  type,
  tmdbId,
  imdbId,
  title,
  year,
  season,
  episode,
}: {
  type: "movie" | "tv";
  tmdbId: string;
  imdbId?: string;
  title?: string;
  year?: string;
  season?: number;
  episode?: number;
}): Promise<CinemaosResult> {
  if (type === "tv" && (season == null || episode == null)) {
    throw new Error("Missing season/episode");
  }

  const referer =
    type === "movie"
      ? `${CINEMAOS_BASE}/watch/movie/${tmdbId}`
      : `${CINEMAOS_BASE}/watch/tv/${tmdbId}/${season}/${episode}`;

  const params = new URLSearchParams({ type, tmdb_id: tmdbId });
  if (type === "movie") {
    if (imdbId) params.set("imdb_id", imdbId);
    if (title) params.set("title", title);
    if (year) params.set("year", year);
  } else {
    params.set("season", String(season));
    params.set("episode", String(episode));
  }

  const apiUrl = `${CINEMAOS_BASE}/api/cinemaos-extract?${params.toString()}`;

  let resp: Response;
  try {
    resp = await fetch(apiUrl, {
      headers: {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: referer,
        "User-Agent": BROWSER_UA,
      },
      signal: timeoutSignal(15000),
    });
  } catch (e) {
    throw new Error(
      `CinemaOS API fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!resp.ok) throw new Error(`CinemaOS API HTTP ${resp.status}`);

  // The API streams newline-delimited JSON (Content-Type:
  // application/x-ndjson) instead of one JSON object — one `{"source": {...}}`
  // line per discovered source, terminated by a final `{"done":true,"found":bool}`
  // line, rather than a single `{found, sources: [...]}` body.
  let body: string;
  try {
    body = await resp.text();
  } catch {
    throw new Error("CinemaOS API response unreadable");
  }

  let found = false;
  const rawSources: unknown[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines rather than failing the whole stream
    }
    if ("source" in obj) {
      rawSources.push(obj.source);
    } else if ("done" in obj) {
      found = !!obj.found;
    }
  }

  if (!found || rawSources.length === 0) {
    throw new Error("CinemaOS: no sources found");
  }

  const sources = rawSources
    .map(toCinemaosSource)
    .filter((s): s is CinemaosSource => s !== null);

  if (sources.length === 0)
    throw new Error("CinemaOS: sources present but all malformed");

  return { sources };
}
