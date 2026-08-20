import { useEffect, useMemo, useRef, useState } from "react";
import type { CinemaosSource } from "@/lib/cinemaos.server";
import {
  buildCandidateList,
  type ProbeCandidate,
  type ProbeStatus,
} from "@/lib/stream-candidates";

interface UseSmartServerProbeOptions {
  sources: CinemaosSource[] | null;
  cap?: number;
  concurrency?: number;
  perProbeTimeoutMs?: number;
  overallBudgetMs?: number;
}

interface UseSmartServerProbeResult {
  /** Score-sorted, individually-selectable candidates with live probe status. */
  candidates: ProbeCandidate[];
  isProbing: boolean;
  /** scraperNames currently being checked right now, for "Checking X..." UI. */
  currentlyChecking: string[];
  /** Highest-scored candidate regardless of probe status — used for the immediate auto-pick. */
  topCandidate: ProbeCandidate | null;
  markVerifiedByPlayer: (id: string) => void;
  markBadByPlayer: (id: string) => void;
}

// These relay URLs are cross-origin media hosts that don't necessarily send
// CORS response headers (they're built to be hit by <video>/hls.js/dashjs,
// not read via `fetch`). Requesting in "cors" mode with a custom header
// (e.g. Range) triggers a preflight most of these workers never answer,
// which was making almost every candidate come back "bad" even though it
// played fine. "no-cors" sidesteps that: the browser still makes the real
// network request and the promise still rejects on a genuine network
// failure (DNS, refused connection, timeout) — we just can't read the
// opaque response's status, so this only screens out truly unreachable
// hosts and leaves HTTP-level errors (expired signed URLs, 403s, etc.) to
// be caught by the real player attempt (onPlaybackReady/onError).
async function probeOne(
  url: string,
  timeoutMs: number,
  outerSignal: AbortSignal,
): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  outerSignal.addEventListener("abort", onAbort, { once: true });
  try {
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      signal: ctrl.signal,
      cache: "no-store",
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    outerSignal.removeEventListener("abort", onAbort);
  }
}

/**
 * Ranks + validates cinemaos candidate streams client-side. Never gates
 * playback: the caller should auto-pick `topCandidate` the instant sources
 * arrive, while this hook probes reachability in the background purely to
 * enrich the server-selector's live status (checking/verified/bad).
 */
export function useSmartServerProbe(
  opts: UseSmartServerProbeOptions,
): UseSmartServerProbeResult {
  // These are cheap no-cors reachability pings, not real page loads — no
  // need to throttle them. A low concurrency limit combined with a
  // per-probe timeout was what left the tail of a long candidate list stuck
  // "pending" forever once the overall budget ran out before their turn.
  // Defaulting concurrency to the cap runs every candidate in one round.
  const {
    sources,
    cap = 20,
    concurrency = cap,
    perProbeTimeoutMs = 4000,
    overallBudgetMs = 12000,
  } = opts;
  const [statusMap, setStatusMap] = useState<Record<string, ProbeStatus>>({});
  const abortRef = useRef<AbortController | null>(null);

  const baseCandidates = useMemo(
    () => (sources ? buildCandidateList(sources, cap) : []),
    [sources, cap],
  );

  useEffect(() => {
    abortRef.current?.abort();
    if (baseCandidates.length === 0) {
      setStatusMap({});
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatusMap({});

    let idx = 0;
    const deadline = Date.now() + overallBudgetMs;

    async function worker() {
      while (
        idx < baseCandidates.length &&
        Date.now() < deadline &&
        !ctrl.signal.aborted
      ) {
        const c = baseCandidates[idx++];
        setStatusMap((m) => ({ ...m, [c.id]: "checking" }));
        const ok = await probeOne(c.url, perProbeTimeoutMs, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setStatusMap((m) =>
          m[c.id] === "verified" || m[c.id] === "bad"
            ? m
            : { ...m, [c.id]: ok ? "verified" : "bad" },
        );
      }
    }

    Promise.all(
      Array.from(
        { length: Math.min(concurrency, baseCandidates.length) },
        worker,
      ),
    ).catch(() => {});

    return () => ctrl.abort();
  }, [baseCandidates, concurrency, perProbeTimeoutMs, overallBudgetMs]);

  const candidates = useMemo(
    () =>
      baseCandidates.map((c) => ({
        ...c,
        status: statusMap[c.id] ?? "pending",
      })),
    [baseCandidates, statusMap],
  );

  const isProbing = candidates.some(
    (c) => c.status === "checking" || c.status === "pending",
  );
  const currentlyChecking = candidates
    .filter((c) => c.status === "checking")
    .map((c) => c.displayName);
  const topCandidate = candidates[0] ?? null;

  const markVerifiedByPlayer = (id: string) =>
    setStatusMap((m) => ({ ...m, [id]: "verified" }));
  const markBadByPlayer = (id: string) =>
    setStatusMap((m) => ({ ...m, [id]: "bad" }));

  return {
    candidates,
    isProbing,
    currentlyChecking,
    topCandidate,
    markVerifiedByPlayer,
    markBadByPlayer,
  };
}
