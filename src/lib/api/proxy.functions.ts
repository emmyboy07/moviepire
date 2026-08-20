import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const proxyImageSchema = z.object({
  url: z.string().url(),
});

const proxyStreamSchema = z.object({
  url: z.string().url(),
});

/**
 * Proxy external images through the server to avoid CORS issues
 * Usage: const imageUrl = await proxyImage({ data: { url: "https://image.tmdb.org/..." } })
 */
export const proxyImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => proxyImageSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const response = await fetch(data.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!response.ok) {
        return {
          ok: false as const,
          error: `Failed to fetch image: ${response.status}`,
        };
      }

      const buffer = await response.arrayBuffer();
      const contentType =
        response.headers.get("content-type") || "image/jpeg";

      // Return base64 encoded data URL
      const base64 = Buffer.from(buffer).toString("base64");
      return {
        ok: true as const,
        data: `data:${contentType};base64,${base64}`,
      };
    } catch (error) {
      console.error("Image proxy error:", error);
      return {
        ok: false as const,
        error:
          error instanceof Error ? error.message : "Failed to proxy image",
      };
    }
  });

/**
 * Proxy external streams through the server to avoid CORS issues with service worker
 * Usage: const streamUrl = await proxyStream({ data: { url: "https://bcdn.hakunaymatata.com/..." } })
 */
export const proxyStream = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => proxyStreamSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const response = await fetch(data.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://example.com/",
        },
      });

      if (!response.ok) {
        return {
          ok: false as const,
          error: `Failed to fetch stream: ${response.status}`,
        };
      }

      // For streams, we should return the URL with proper headers
      // In a real implementation, you might want to stream this differently
      // or store it temporarily. For now, returning the original URL with a note
      // that it should be served through the proxy
      return {
        ok: true as const,
        data: {
          url: data.url,
          // In production, you'd implement proper stream proxying here
          // This is a simplified version that just validates the stream exists
        },
      };
    } catch (error) {
      console.error("Stream proxy error:", error);
      return {
        ok: false as const,
        error:
          error instanceof Error ? error.message : "Failed to proxy stream",
      };
    }
  });
