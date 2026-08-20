import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { securityMiddleware } from "./security.middleware";

// ---- Simple in-memory TTL cache ----
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_ENTRIES = 1000;

interface CacheEntry {
  data: unknown;
  expires: number;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): unknown | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function cacheSet(key: string, data: unknown): void {
  // Evict oldest entry if at capacity
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
}

const movieSchema = z.object({
  tmdbId: z.number().int().positive(),
  subjectId: z.string().optional(),
});

const tvSchema = z.object({
  tmdbId: z.number().int().positive(),
  season: z.number().int().min(0).max(100),
  episode: z.number().int().min(0).max(500),
  subjectId: z.string().optional(),
});

const shortDramaSearchSchema = z.object({
  title: z.string().min(1),
});

const shortDramaEpisodeSchema = z.object({
  subjectId: z.string().min(1),
  season: z.number().int().min(1).max(100).default(1),
  episode: z.number().int().min(1).max(500).default(1),
});

const animeSchema = z.object({
  anilistId: z.number().int().positive(),
  episode: z.number().int().min(1).max(500).default(1),
  subjectId: z.string().optional(),
});

const languageQualitiesSchema = z.object({
  languageSubjectId: z.string().min(1),
  languageDetailPath: z.string().default(""),
  season: z.number().int().min(0).max(100).default(0),
  episode: z.number().int().min(0).max(500).default(0),
  languageLabel: z.string().min(1),
  languageCode: z.string().min(1),
});

export const loadMovie = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => movieSchema.parse(d))
  .handler(async ({ data }) => {
    const key = `movie:${data.tmdbId}`;
    const cached = cacheGet(key);
    if (cached) return { ok: true as const, data: cached };

    const { fetchMovieByTmdb } = await import("./media.server");
    const r = await fetchMovieByTmdb(data.tmdbId);
    if (!r) return { ok: false as const, error: "Not found" };
    cacheSet(key, r);
    return { ok: true as const, data: r };
  });

export const loadTv = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => tvSchema.parse(d))
  .handler(async ({ data }) => {
    const key = `tv:${data.tmdbId}:${data.season}:${data.episode}`;
    const cached = cacheGet(key);
    if (cached) return { ok: true as const, data: cached };

    const { fetchTvByTmdb } = await import("./media.server");
    const r = await fetchTvByTmdb(data.tmdbId, data.season, data.episode);
    if (!r) return { ok: false as const, error: "Not found" };
    cacheSet(key, r);
    return { ok: true as const, data: r };
  });

export const loadShortDramaSearch = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => shortDramaSearchSchema.parse(d))
  .handler(async ({ data }) => {
    const { fetchShortDramaSearch } = await import("./media.server");
    const r = await fetchShortDramaSearch(data.title);
    if (!r) return { ok: false as const, error: "Not found" };
    return { ok: true as const, data: r };
  });

export const loadShortDramaEpisode = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => shortDramaEpisodeSchema.parse(d))
  .handler(async ({ data }) => {
    const { fetchShortDramaEpisode } = await import("./media.server");
    const r = await fetchShortDramaEpisode(data.subjectId, data.season, data.episode);
    if (!r) return { ok: false as const, error: "Not found" };
    return { ok: true as const, data: r };
  });

export const loadAnime = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => animeSchema.parse(d))
  .handler(async ({ data }) => {
    const key = `anime:${data.anilistId}:${data.episode}`;
    const cached = cacheGet(key);
    if (cached) return { ok: true as const, data: cached };

    const { fetchAnimeByAnilist } = await import("./media.server");
    const r = await fetchAnimeByAnilist(data.anilistId, data.episode);
    if (!r) return { ok: false as const, error: "Not found" };
    cacheSet(key, r);
    return { ok: true as const, data: r };
  });

// Movie, TV, and anime all share the same wefeed-h5api-bff subjectId/detailPath
// scheme now, so there's one language-qualities fetcher for all three (anime no
// longer needs its own gateway-backed variant).
export const loadLanguageQualities = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => languageQualitiesSchema.parse(d))
  .handler(async ({ data }) => {
    const key = `lang:${data.languageSubjectId}:${data.season}:${data.episode}:${data.languageCode}`;
    const cached = cacheGet(key);
    if (cached) return { ok: true as const, data: cached };

    const { fetchLanguageQualities } = await import("./media.server");
    const r = await fetchLanguageQualities(
      data.languageSubjectId,
      data.languageDetailPath,
      data.season,
      data.episode,
      data.languageCode,
      data.languageLabel,
    );
    if (!r) return { ok: false as const, error: "Not found" };
    cacheSet(key, r);
    return { ok: true as const, data: r };
  });
