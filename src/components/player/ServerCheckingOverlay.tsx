"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, X, Clock } from "lucide-react";

export type CheckingStatus = "pending" | "checking" | "verified" | "bad";

/** A single row in the testing checklist — alpha/blaze and every nova
 * candidate are all normalized to this same shape so they render uniformly. */
export interface CheckingRow {
  id: string;
  displayName: string;
  status: CheckingStatus;
  type: string;
  quality?: string;
  speed?: string | null;
}

const FETCHING_PHRASES = [
  "Finding sources...",
  "Connecting to servers...",
  "Gathering streams...",
];

interface ServerCheckingOverlayProps {
  color: string;
  poster?: string;
  title?: string;
  /** The full live testing checklist — every server we know about so far,
   * always shown (even mid-fetch, before we know how many there'll be). */
  candidates?: CheckingRow[];
}

/**
 * Shown from the moment the page starts resolving a stream until a working
 * one is found and the player takes over. Always visible — never skipped —
 * so the movie backdrop + live per-server checklist (Queued -> Testing ->
 * Connected/Unavailable) is the one loading experience for every path.
 */
export default function ServerCheckingOverlay({
  color,
  poster,
  title,
  candidates,
}: ServerCheckingOverlayProps) {
  const [idx, setIdx] = useState(0);
  const checkingNames = (candidates ?? [])
    .filter((c) => c.status === "checking")
    .map((c) => c.displayName);
  const cyclingNames =
    checkingNames.length > 0 ? checkingNames : FETCHING_PHRASES;

  useEffect(() => {
    const t = setInterval(
      () => setIdx((i) => (i + 1) % cyclingNames.length),
      1200,
    );
    return () => clearInterval(t);
  }, [cyclingNames.length]);

  const label =
    checkingNames.length > 0
      ? `Checking ${cyclingNames[idx % cyclingNames.length]}...`
      : cyclingNames[idx % cyclingNames.length];

  const verifiedCount = (candidates ?? []).filter(
    (c) => c.status === "verified",
  ).length;
  const badCount = (candidates ?? []).filter((c) => c.status === "bad").length;
  const total = candidates?.length ?? 0;

  return (
    <div className="relative flex h-screen w-screen flex-col items-center justify-center overflow-hidden bg-[#07070b]">
      {poster && (
        <>
          <img
            src={
              poster.startsWith("http")
                ? `/api/proxy-image?url=${encodeURIComponent(poster)}`
                : poster
            }
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#07070b] via-[#07070b]/85 to-[#07070b]/50" />
        </>
      )}

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-5 px-6">
        <div className="relative">
          <div
            className="absolute inset-0 rounded-xl blur-xl animate-pulse"
            style={{ backgroundColor: `${color}40` }}
          />
          <div
            className="relative flex h-12 w-12 items-center justify-center rounded-xl"
            style={{
              background: `linear-gradient(135deg, ${color}, ${color}99)`,
              boxShadow: `0 8px 24px ${color}40`,
            }}
          >
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        </div>

        {title && (
          <p className="text-center text-base font-black uppercase tracking-wide text-white/90 line-clamp-1">
            {title}
          </p>
        )}

        <p
          key={label}
          className="text-sm font-semibold tracking-wide text-white/60 animate-in fade-in duration-300"
        >
          {label}
        </p>

        {total > 0 && (
          <>
            <p className="text-[11px] text-white/30">
              {verifiedCount} connected · {badCount} unavailable · {total} total
            </p>
            <div className="max-h-[40vh] w-full overflow-y-auto rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md custom-scrollbar">
              <div className="divide-y divide-white/5">
                {candidates!.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <StatusIcon status={c.status} color={color} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-bold tracking-tight text-white/90">
                          {c.displayName}
                        </span>
                        <span className="flex-shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-black text-white/50">
                          {c.type.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-[10px] font-bold text-white/40">
                      {statusLabel(c.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function statusLabel(status: CheckingStatus): string {
  switch (status) {
    case "verified":
      return "Connected";
    case "bad":
      return "Unavailable";
    case "checking":
      return "Testing...";
    default:
      return "Queued";
  }
}

function StatusIcon({
  status,
  color,
}: {
  status: CheckingStatus;
  color: string;
}) {
  if (status === "verified") {
    return (
      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-green-500/20">
        <Check className="h-3 w-3 text-green-400" />
      </div>
    );
  }
  if (status === "bad") {
    return (
      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-500/20">
        <X className="h-3 w-3 text-red-400" />
      </div>
    );
  }
  if (status === "checking") {
    return (
      <div
        className="flex h-5 w-5 flex-shrink-0 animate-spin items-center justify-center rounded-full border-2 border-transparent"
        style={{ borderTopColor: color, borderRightColor: `${color}40` }}
      />
    );
  }
  return (
    <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/5">
      <Clock className="h-3 w-3 text-white/30" />
    </div>
  );
}
