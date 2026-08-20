import { createMiddleware } from "@tanstack/react-start";

// ─── Runtime guard ─────────────────────────────────────────────────────────────
const isBrowser = typeof window !== "undefined";

// ─── Server-only secret (lazy) ─────────────────────────────────────────────────
// Resolved on first actual use, not at module-import time. Vite/TanStack Start's
// build step statically imports this module to discover createServerFn calls —
// that is NOT the same as a real server starting up and serving requests, so
// failing closed here at import time breaks `vite build` itself whenever
// SESSION_SECRET isn't present in the *build* environment, even though the
// real running server has it fine at runtime. Deferring the check until the
// secret is actually needed preserves the fail-closed guarantee for real
// traffic without making the build depend on a runtime-only secret.
let cachedServerSecret: string | null = null;

function getServerSecret(): string {
  if (cachedServerSecret !== null) return cachedServerSecret;

  if (isBrowser) {
    // Should never actually be reached client-side, but don't throw during
    // module evaluation in a browser context either.
    cachedServerSecret = "";
    return cachedServerSecret;
  }

  const fromEnv = process.env.SESSION_SECRET || "";
  if (!fromEnv) {
    if (process.env.NODE_ENV === "production") {
      // Fail closed: a public, repo-committed secret lets anyone forge proxy sigs.
      throw new Error(
        "SESSION_SECRET is not set — refusing to serve requests with a public fallback secret.",
      );
    }
    cachedServerSecret = "dev-only-insecure-fallback-secret";
  } else {
    cachedServerSecret = fromEnv;
  }

  return cachedServerSecret;
}

// ─── Buffer / Hex helpers ──────────────────────────────────────────────────────
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuffer(hex: string): ArrayBuffer {
  const view = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < view.length; i++) {
    view[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return view.buffer;
}

// ─── HMAC-SHA-256 helpers ──────────────────────────────────────────────────────
async function hmacSha256(key: string | ArrayBuffer, message: string): Promise<string> {
  const rawKey =
    typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return bufferToHex(sig);
}

async function sha256(message: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(message),
  );
  return bufferToHex(hash);
}

// ─── User-Agent fingerprint (server-only) ─────────────────────────────────────
// Returns the first 16 hex chars of SHA-256(ua + secret) — enough for binding,
// not reversible to the original UA.
async function fingerprintUA(ua: string): Promise<string> {
  const full = await sha256(`ua:${ua}:${getServerSecret()}`);
  return full.substring(0, 16);
}

// ─── Session token ─────────────────────────────────────────────────────────────
// Format: <timestamp>.<rand>.<uaFingerprint>.<sig>
// The signature covers all three fields, so any tampering invalidates it.

export async function generateSessionToken(userAgent: string): Promise<string> {
  const timestamp = Date.now().toString();
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  const rand = bufferToHex(randomBytes.buffer);
  const uaFp = await fingerprintUA(userAgent);
  const payload = `${timestamp}.${rand}.${uaFp}`;
  const sig = await hmacSha256(getServerSecret(), payload);
  return `${payload}.${sig}`;
}

/**
 * Verify a session token.
 * @param token     - The raw cookie value
 * @param userAgent - The User-Agent of the current request (for binding check)
 */
export async function verifySessionToken(
  token: string,
  userAgent: string,
): Promise<boolean> {
  try {
    const parts = token.split(".");
    // Support legacy 3-part tokens (pre-UA-binding): treat them as invalid so
    // the server will issue a fresh, properly-bound token.
    if (parts.length !== 4) return false;

    const [timestampStr, rand, uaFp, sig] = parts;
    const payload = `${timestampStr}.${rand}.${uaFp}`;

    // 1. Signature check
    const expectedSig = await hmacSha256(getServerSecret(), payload);
    if (sig !== expectedSig) return false;

    // 2. Expiry check (24 h)
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) return false;
    const age = Date.now() - timestamp;
    if (age < 0 || age > 24 * 60 * 60 * 1000) return false;

    // 3. User-Agent binding check
    const expectedUaFp = await fingerprintUA(userAgent);
    if (uaFp !== expectedUaFp) return false;

    return true;
  } catch {
    return false;
  }
}

// ─── Client nonce key derivation ───────────────────────────────────────────────
// The "client key" is a non-secret, browser-readable value derived from the
// session token. It is stored in a readable (non-HttpOnly) cookie so client JS
// can use it to compute per-request nonces without ever seeing the session token.
//
// clientKey = HMAC-SHA256(key=serverSecret, msg="nonce-key:<sessionToken>")

export async function deriveClientKey(sessionToken: string): Promise<string> {
  return hmacSha256(getServerSecret(), `nonce-key:${sessionToken}`);
}

// ─── Per-request HMAC nonce ────────────────────────────────────────────────────
// Format: <timestampSeconds>.<hmac>
// The HMAC is computed over the integer second timestamp, keyed with the clientKey.
// Each second produces a different nonce; the server accepts a ±30 s window.

export async function computeRequestNonce(
  clientKey: string,
  timestampSeconds: number,
): Promise<string> {
  const mac = await hmacSha256(hexToBuffer(clientKey), String(timestampSeconds));
  return `${timestampSeconds}.${mac}`;
}

/**
 * Verify a per-request nonce on the server.
 * Re-derives the clientKey from the sessionToken and checks the HMAC.
 */
export async function verifyRequestNonce(
  nonce: string,
  sessionToken: string,
  windowSeconds = 30,
): Promise<boolean> {
  try {
    const dotIdx = nonce.indexOf(".");
    if (dotIdx === -1) return false;
    const tsStr = nonce.substring(0, dotIdx);
    const receivedMac = nonce.substring(dotIdx + 1);

    const ts = parseInt(tsStr, 10);
    if (isNaN(ts)) return false;

    // Timestamp window check
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > windowSeconds) return false;

    // Re-derive clientKey and recompute expected MAC
    const clientKey = await deriveClientKey(sessionToken);
    const expectedMac = await hmacSha256(
      hexToBuffer(clientKey),
      String(ts),
    );

    return receivedMac === expectedMac;
  } catch {
    return false;
  }
}

// ─── HLS proxy session signing ─────────────────────────────────────────────────
// A single session token covers all segment URLs in one manifest fetch.
// sig = HMAC-SHA256(serverSecret, "hls-proxy|" + exp)
// The server additionally enforces a target-domain whitelist (vixsrc.to /
// vix-content.net — see /api/hls-proxy in server.ts), which is what keeps this
// session-scoped (not URL-bound) signature from becoming an open relay.
//
// TTL note: VOD segment URLs are signed once, when the media playlist is
// rewritten, and must stay valid for the whole watch, so the TTL has to exceed
// the longest single piece of content, not "a few minutes".
//
// Verification happens locally in this same process (/api/hls-proxy in
// server.ts) — the stream now proxies through our own server, not an external
// Cloudflare Worker.
const HLS_PROXY_TTL = 6 * 60 * 60; // 6h — covers feature-length VOD

export async function signHlsProxySession(): Promise<{ sig: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + HLS_PROXY_TTL;
  const sig = await hmacSha256(getServerSecret(), `hls-proxy|${exp}`);
  return { sig, exp };
}

export async function verifyHlsProxySession(exp: string, sig: string): Promise<boolean> {
  const expNum = parseInt(exp, 10);
  if (isNaN(expNum)) return false;
  if (Math.floor(Date.now() / 1000) > expNum) return false;
  const expected = await hmacSha256(getServerSecret(), `hls-proxy|${exp}`);
  return sig === expected;
}

// ─── Cookie parser ─────────────────────────────────────────────────────────────
export function parseCookies(cookieStr: string | null): Record<string, string> {
  if (!cookieStr) return {};
  return Object.fromEntries(
    cookieStr.split(";").map((c) => {
      const parts = c.trim().split("=");
      return [parts[0], parts.slice(1).join("=")];
    }),
  );
}

// ─── Client key resolution ─────────────────────────────────────────────────────
// Priority 1: window.__MEDIA_CLIENT_KEY__ — injected server-side into the HTML
//             <head> before any module scripts run. Always available, zero race.
// Priority 2: media_client_key cookie — fallback for non-HTML contexts.
function getClientKey(): string | null {
  if (typeof window === "undefined") return null;

  // Server-injected key (preferred)
  const injected = (
    window as typeof window & { __MEDIA_CLIENT_KEY__?: string }
  ).__MEDIA_CLIENT_KEY__;
  if (injected) return injected;

  // Cookie fallback
  const match = document.cookie.match(/(?:^|;\s*)media_client_key=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ─── TanStack middleware ────────────────────────────────────────────────────────
// Attaches a fresh per-request HMAC nonce on every server function call.
// The nonce key is always available via window.__MEDIA_CLIENT_KEY__ (injected
// server-side), so the nonce is always computable — no race, no "missing = ok".
export const securityMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const clientKey = getClientKey();
    if (!clientKey) {
      // Should never happen in production: key is injected server-side.
      // In dev, if the page hasn't loaded yet, log and proceed — the server
      // gate will reject with 403 giving a clear error rather than silently failing.
      console.warn("[security] No client key available — nonce cannot be generated.");
      return next();
    }
    const ts = Math.floor(Date.now() / 1000);
    const nonce = await computeRequestNonce(clientKey, ts);
    return next({ headers: { "x-request-nonce": nonce } });
  })
  .server(async ({ next }) => {
    return next();
  });
