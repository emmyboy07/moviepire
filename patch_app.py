#!/usr/bin/env python3
"""Idempotent patcher: Bun -> Cloudflare Worker streaming migration."""
import os

def patch(path, edits):
    if not os.path.exists(path):
        print(f"  MISSING  {path}"); return
    s = open(path, encoding="utf-8").read(); orig = s
    for before, after in edits:
        if after in s:            # already applied (works for insert & replace)
            continue
        if before not in s:
            print(f"  !! anchor not found in {path}: {before[:60]!r}")
            continue
        s = s.replace(before, after, 1)
    if s != orig:
        open(path, "w", encoding="utf-8").write(s); print(f"  patched  {path}")
    else:
        print(f"  skip     {path}")

SP_OLD = 'const STREAM_PROXY = import.meta.env.VITE_STREAM_PROXY_URL || "https://stream-box-proxy.raket.workers.dev";'
SP_NEW = 'const STREAM_PROXY = (import.meta.env.VITE_STREAM_PROXY_URL || "https://stream-box-proxy.raket.workers.dev").replace(/\\/$/, "");'
VPS_OLD = 'if (tier === "vps") return `/api/proxy-stream?url=${encodeURIComponent(secure)}`;'
VPS_NEW = 'if (tier === "vps") return `${STREAM_PROXY}/stream?url=${encodeURIComponent(secure)}`;'
SUB_OLD = 'url: `/api/proxy-subtitle?url=${encodeURIComponent(c.url)}`'
SUB_NEW = 'url: `${STREAM_PROXY}/subtitle?url=${encodeURIComponent(c.url)}`'
route_edits = [(SP_OLD, SP_NEW), (VPS_OLD, VPS_NEW), (SUB_OLD, SUB_NEW)]

for f in ["src/routes/embed/movie/$tmdbId.tsx",
          "src/routes/embed/tv/$tmdbId/$season/$episode.tsx",
          "src/routes/stream/anime/$anilistId/$episode.tsx"]:
    patch(f, route_edits)

patch("src/components/player/PremiumPlayer.tsx", [
  ('function isHlsUrl(streamUrl: string): boolean {',
   SP_NEW + '\n\nfunction isHlsUrl(streamUrl: string): boolean {'),
  ('    streamUrl.includes("/api/hls-proxy") ||',
   '    streamUrl.includes("/api/hls-proxy") ||\n    streamUrl.includes("/hls?url=") ||'),
  ('      ? `/api/proxy-image?url=${encodeURIComponent(poster)}`',
   '      ? `${STREAM_PROXY}/image?url=${encodeURIComponent(poster)}`'),
])

patch("src/lib/vixsrc.server.ts", [
  ('const BROWSER_UA =\n  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";',
   'const BROWSER_UA =\n  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";\n// The consolidated streaming Worker that now serves /hls (Froxy egress lives\n// there). Same origin you point VITE_STREAM_PROXY_URL at. Trailing slash stripped\n// so `${HLS_WORKER}/hls` never becomes `//hls`.\nconst HLS_WORKER = envOr(process.env.VIXSRC_PROXY_URL, "https://alphaproxy.raket.workers.dev").replace(/\\/$/, "");'),
  ('      `/api/hls-proxy?url=${encodeURIComponent(finalPlaylistUrl)}` +',
   '      `${HLS_WORKER}/hls?url=${encodeURIComponent(finalPlaylistUrl)}` +'),
])

sp = "src/server.ts"
if os.path.exists(sp):
    s = open(sp, encoding="utf-8").read(); orig = s
    s = s.replace(
'''import {
  generateSessionToken,
  verifySessionToken,
  deriveClientKey,
  verifyRequestNonce,
  signHlsProxyUrl,
  verifyHlsProxyUrl,
} from "./lib/security.middleware";
import { proxyFetch, isValidStickyPort } from "./lib/proxy-pool.server";
import { envOr } from "./lib/config.server";''',
'''import {
  generateSessionToken,
  verifySessionToken,
  deriveClientKey,
  verifyRequestNonce,
} from "./lib/security.middleware";''')
    s = s.replace(
'''      const proxyResponse = await handleProxyRequest(request);
      if (proxyResponse) {
        return proxyResponse;
      }

''', '')
    lines = s.split("\n")
    start = next((i for i,l in enumerate(lines) if l.startswith("function hlsLangVariants")), None)
    norm  = next((i for i,l in enumerate(lines) if l.startswith("async function normalizeCatastrophicSsrResponse")), None)
    if start is not None and norm is not None:
        end = norm - 1
        while lines[end].strip() == "": end -= 1
        if lines[end].strip() == "}":
            del lines[start:end+1]; s = "\n".join(lines)
    if s != orig:
        open(sp, "w", encoding="utf-8").write(s); print(f"  patched  {sp}")
    else:
        print(f"  skip     {sp}")

print("done.")
