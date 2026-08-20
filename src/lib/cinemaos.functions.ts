import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { securityMiddleware } from "./security.middleware";

const cinemaosMovieSchema = z.object({
  tmdbId: z.string().min(1),
  imdbId: z.string().optional(),
  title: z.string().optional(),
  year: z.string().optional(),
});

const cinemaosTvSchema = z.object({
  tmdbId: z.string().min(1),
  season: z.number().int().min(1),
  episode: z.number().int().min(1),
});

export const loadCinemaosMovie = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => cinemaosMovieSchema.parse(d))
  .handler(async ({ data }) => {
    const { extractCinemaosStreams } = await import("./cinemaos.server");
    try {
      const r = await extractCinemaosStreams({ type: "movie", ...data });
      return { ok: true as const, data: r };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[CinemaOS movie]", msg);
      return { ok: false as const, error: msg };
    }
  });

export const loadCinemaosTv = createServerFn({ method: "POST" })
  .middleware([securityMiddleware])
  .inputValidator((d: unknown) => cinemaosTvSchema.parse(d))
  .handler(async ({ data }) => {
    const { extractCinemaosStreams } = await import("./cinemaos.server");
    try {
      const r = await extractCinemaosStreams({
        type: "tv",
        tmdbId: data.tmdbId,
        season: data.season,
        episode: data.episode,
      });
      return { ok: true as const, data: r };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[CinemaOS tv]", msg);
      return { ok: false as const, error: msg };
    }
  });
