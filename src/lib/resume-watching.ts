const STORAGE_PREFIX = "sb_resume:";

export function resumeKey(parts: {
  type: "movie" | "tv";
  tmdbId: string;
  season?: number;
  episode?: number;
}): string {
  return parts.type === "movie"
    ? `${STORAGE_PREFIX}movie:${parts.tmdbId}`
    : `${STORAGE_PREFIX}tv:${parts.tmdbId}:${parts.season}:${parts.episode}`;
}

/** Returns a saved position in seconds, or null if none/too close to the start. */
export function loadResumePosition(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const position = Number(raw);
    return Number.isFinite(position) && position > 5 ? position : null;
  } catch {
    return null;
  }
}

export function saveResumePosition(key: string, position: number): void {
  try {
    localStorage.setItem(key, String(Math.floor(position)));
  } catch {
    // localStorage unavailable (private browsing, quota) — ignore
  }
}

export function clearResumePosition(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
