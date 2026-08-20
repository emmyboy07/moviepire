"use server";

// Single source of truth for display metadata (title/poster/backdrop/year)
// and, for series, the season/episode list — fetched directly from TMDB so
// it's available and accurate regardless of which streaming provider (or
// none) ends up supplying the actual video.
const TMDB_API_KEY =
  process.env.TMDB_API_KEY ?? "1e2d76e7c45818ed61645cb647981e5c";
const TMDB_BASE = "https://api.themoviedb.org/3";

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export interface TmdbMeta {
  title: string;
  year: string | null;
  poster?: string;
  backdrop?: string;
  overview?: string;
}

export interface TmdbTvMeta extends TmdbMeta {
  seasons: { season_number: number; episode_count: number; name: string }[];
}

function posterUrl(path: unknown): string | undefined {
  return typeof path === "string" && path
    ? `https://image.tmdb.org/t/p/w500${path}`
    : undefined;
}

function backdropUrl(path: unknown): string | undefined {
  return typeof path === "string" && path
    ? `https://image.tmdb.org/t/p/w1280${path}`
    : undefined;
}

export async function fetchTmdbMovieMeta(
  tmdbId: string,
): Promise<TmdbMeta | null> {
  try {
    const res = await fetch(
      `${TMDB_BASE}/movie/${tmdbId}?api_key=${TMDB_API_KEY}`,
      {
        signal: timeoutSignal(8000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: String(data.title || data.original_title || ""),
      year:
        typeof data.release_date === "string" && data.release_date
          ? data.release_date.slice(0, 4)
          : null,
      poster: posterUrl(data.poster_path),
      backdrop: backdropUrl(data.backdrop_path),
      overview: typeof data.overview === "string" ? data.overview : undefined,
    };
  } catch {
    return null;
  }
}

export async function fetchTmdbTvMeta(
  tmdbId: string,
): Promise<TmdbTvMeta | null> {
  try {
    const res = await fetch(
      `${TMDB_BASE}/tv/${tmdbId}?api_key=${TMDB_API_KEY}`,
      {
        signal: timeoutSignal(8000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const seasons = Array.isArray(data.seasons)
      ? data.seasons
          .filter(
            (s: unknown) =>
              !!s &&
              typeof s === "object" &&
              (s as { season_number?: number }).season_number! > 0,
          )
          .map(
            (s: {
              season_number: number;
              episode_count: number;
              name?: string;
            }) => ({
              season_number: s.season_number,
              episode_count: s.episode_count,
              name: s.name || `Season ${s.season_number}`,
            }),
          )
      : [];
    return {
      title: String(data.name || data.original_name || ""),
      year:
        typeof data.first_air_date === "string" && data.first_air_date
          ? data.first_air_date.slice(0, 4)
          : null,
      poster: posterUrl(data.poster_path),
      backdrop: backdropUrl(data.backdrop_path),
      overview: typeof data.overview === "string" ? data.overview : undefined,
      seasons,
    };
  } catch {
    return null;
  }
}
