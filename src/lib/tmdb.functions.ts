import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { securityMiddleware } from "./security.middleware";

const tmdbMetaSchema = z.object({
  tmdbId: z.string().min(1),
});

export const loadTmdbMovieMeta = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => tmdbMetaSchema.parse(d))
  .handler(async ({ data }) => {
    const { fetchTmdbMovieMeta } = await import("./tmdb.server");
    const meta = await fetchTmdbMovieMeta(data.tmdbId);
    if (!meta) return { ok: false as const, error: "TMDB lookup failed" };
    return { ok: true as const, data: meta };
  });

export const loadTmdbTvMeta = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => tmdbMetaSchema.parse(d))
  .handler(async ({ data }) => {
    const { fetchTmdbTvMeta } = await import("./tmdb.server");
    const meta = await fetchTmdbTvMeta(data.tmdbId);
    if (!meta) return { ok: false as const, error: "TMDB lookup failed" };
    return { ok: true as const, data: meta };
  });
