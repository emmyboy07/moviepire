import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { securityMiddleware } from "./security.middleware";

const vixSrcMovieSchema = z.object({
  tmdbId: z.string().min(1),
  language: z.string().default("en"),
});

const vixSrcTvSchema = z.object({
  tmdbId: z.string().min(1),
  season: z.number().int().min(1),
  episode: z.number().int().min(1),
  language: z.string().default("en"),
});

export const loadVixSrcMovie = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => vixSrcMovieSchema.parse(d))
  .handler(async ({ data }) => {
    const { extractVixSrcStream } = await import("./vixsrc.server");
    try {
      const r = await extractVixSrcStream({ type: "movie", id: data.tmdbId, language: data.language });
      return { ok: true as const, data: r };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[VixSrc movie]", msg);
      return { ok: false as const, error: msg };
    }
  });

export const loadVixSrcTv = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => vixSrcTvSchema.parse(d))
  .handler(async ({ data }) => {
    const { extractVixSrcStream } = await import("./vixsrc.server");
    try {
      const r = await extractVixSrcStream({
        type: "tv",
        id: data.tmdbId,
        season: data.season,
        episode: data.episode,
        language: data.language,
      });
      return { ok: true as const, data: r };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[VixSrc tv]", msg);
      return { ok: false as const, error: msg };
    }
  });
