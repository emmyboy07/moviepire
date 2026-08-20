import type { CinemaosSource } from "./cinemaos.server";

export type ProbeStatus = "pending" | "checking" | "verified" | "bad";

export interface ProbeCandidate extends CinemaosSource {
  score: number;
  status: ProbeStatus;
  /** Unique display label — the upstream API reuses the same `label` (e.g.
   * "Alpha - English") across different scraperIds, so the label alone
   * isn't unique. Combines both so duplicates are visually distinguishable. */
  displayName: string;
}

const QUALITY_RANK: Record<string, number> = {
  "4k": 6,
  "2160p": 6,
  "1080p": 5,
  fhd: 5,
  "720p": 4,
  hd: 4,
  "480p": 3,
  "360p": 2,
  auto: 1,
};

function qualityScore(q: string): number {
  return QUALITY_RANK[q.trim().toLowerCase()] ?? 1;
}

function speedScore(s: string | null): number {
  if (!s) return 0;
  const v = s.toLowerCase();
  if (v.includes("ultra")) return 2;
  if (v.includes("fast")) return 1;
  return 0;
}

function typeScore(t: CinemaosSource["type"]): number {
  return t === "dash" || t === "hls" ? 2 : 1;
}

export function scoreCandidate(s: CinemaosSource): number {
  return (
    (s.verified ? 100 : 0) +
    typeScore(s.type) * 10 +
    speedScore(s.speed) * 5 +
    qualityScore(s.quality)
  );
}

/** The upstream API reuses the same `label` across different scraperIds
 * (e.g. both "mb7" and "mb2" label an entry "Alpha - English") — combine
 * with scraperName so duplicates in the UI are always distinguishable. */
function displayNameFor(s: CinemaosSource): string {
  return s.label && s.label !== s.scraperName
    ? `${s.label} · ${s.scraperName}`
    : s.scraperName;
}

/** Dedupe by URL, score, sort desc (stable), cap to `cap`. Every entry stays standalone/individually selectable. */
export function buildCandidateList(
  sources: CinemaosSource[],
  cap = 20,
): ProbeCandidate[] {
  const seen = new Set<string>();
  const deduped = sources.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
  const scored: ProbeCandidate[] = deduped.map((s) => ({
    ...s,
    score: scoreCandidate(s),
    status: "pending",
    displayName: displayNameFor(s),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, cap);
}
