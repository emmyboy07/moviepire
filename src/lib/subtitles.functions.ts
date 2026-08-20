import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { securityMiddleware } from "./security.middleware";

const vdrkMovieSchema = z.object({
  tmdbId: z.string().min(1),
});

const vdrkTvSchema = z.object({
  tmdbId: z.string().min(1),
  season: z.number().int().min(1),
  episode: z.number().int().min(1),
});

export const loadVdrkSubtitlesMovie = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => vdrkMovieSchema.parse(d))
  .handler(async ({ data }) => {
    const { extractVdrkSubtitles } = await import("./subtitles.server");
    try {
      const subtitles = await extractVdrkSubtitles({
        type: "movie",
        tmdbId: data.tmdbId,
      });
      return { ok: true as const, data: subtitles };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Vdrk subtitles movie]", msg);
      return { ok: false as const, error: msg };
    }
  });

export const loadVdrkSubtitlesTv = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => vdrkTvSchema.parse(d))
  .handler(async ({ data }) => {
    const { extractVdrkSubtitles } = await import("./subtitles.server");
    try {
      const subtitles = await extractVdrkSubtitles({
        type: "tv",
        tmdbId: data.tmdbId,
        season: data.season,
        episode: data.episode,
      });
      return { ok: true as const, data: subtitles };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Vdrk subtitles tv]", msg);
      return { ok: false as const, error: msg };
    }
  });
