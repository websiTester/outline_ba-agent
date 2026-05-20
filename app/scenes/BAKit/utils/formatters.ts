/**
 * Small UI formatters reused across BA Kit components.
 *
 * Keeping these in one place avoids scattering string-manipulation helpers
 * through view code and keeps card/list templates readable.
 */

import type { JobStatus } from "../types";

/**
 * Reduce a description that was parsed out of a markdown template down to
 * something safe to show inside a small card. We strip:
 *   - leading `> ` blockquote markers (kit templates open with a `FIS analog`
 *     callout that bleeds into the description)
 *   - `**bold**` / `*italic*` emphasis markers
 *   - `` `code` `` backticks
 *   - leading/trailing whitespace + collapse newlines
 *
 * After cleaning we keep only the first sentence (or 140 chars) so cards
 * stay visually balanced even when the source description is long.
 */
export function stripMarkdownPreview(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  let text = input.trim();
  // Drop blockquote prefixes that the kit uses for `FIS analog` callouts.
  text = text.replace(/^>\s+/gm, "");
  // Strip emphasis markers — preserve inner text.
  text = text.replace(/\*\*(.+?)\*\*/g, "$1");
  text = text.replace(/\*(.+?)\*/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  // Collapse newlines so line-clamp can trim cleanly.
  text = text.replace(/\s+/g, " ").trim();
  // First sentence or 140-char cap, whichever comes first.
  const firstSentenceEnd = text.search(/[.!?]\s/);
  if (firstSentenceEnd !== -1 && firstSentenceEnd < 140) {
    return text.slice(0, firstSentenceEnd + 1);
  }
  return text.length > 140 ? text.slice(0, 137) + "…" : text;
}

/**
 * Friendly relative time (e.g. "5 min ago", "2 h ago"). Falls back to a
 * locale date string for anything older than 7 days.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 45) {
    return "just now";
  }
  if (diffSec < 60 * 60) {
    return `${Math.round(diffSec / 60)} min ago`;
  }
  if (diffSec < 60 * 60 * 24) {
    return `${Math.round(diffSec / 3600)} h ago`;
  }
  if (diffSec < 60 * 60 * 24 * 7) {
    return `${Math.round(diffSec / 86400)} d ago`;
  }
  return new Date(iso).toLocaleDateString();
}

/**
 * Pretty status metadata used by job rows + section badges. Single source of
 * truth so badges don't drift across components.
 */
export type StatusMeta = {
  label: string;
  // Tailwind classes for the dot (text color) — keeps it consistent w/ Outline.
  dotClass: string;
  // Background + text classes for a pill-style chip.
  chipClass: string;
};

export function jobStatusMeta(status: JobStatus): StatusMeta {
  switch (status) {
    case "pending":
      return {
        label: "Pending",
        dotClass: "bg-slate-400",
        chipClass: "bg-slate-100 text-slate-600",
      };
    case "running":
      return {
        label: "Running",
        dotClass: "bg-blue-500",
        chipClass: "bg-blue-50 text-blue-700",
      };
    case "awaiting_input":
      return {
        label: "Awaiting input",
        dotClass: "bg-amber-500",
        chipClass: "bg-amber-50 text-amber-700",
      };
    case "completed":
      return {
        label: "Done",
        dotClass: "bg-emerald-500",
        chipClass: "bg-emerald-50 text-emerald-700",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        dotClass: "bg-slate-400",
        chipClass: "bg-slate-100 text-slate-600",
      };
    case "error":
      return {
        label: "Error",
        dotClass: "bg-rose-500",
        chipClass: "bg-rose-50 text-rose-700",
      };
    case "paused_after_restart":
      return {
        label: "Paused",
        dotClass: "bg-amber-500",
        chipClass: "bg-amber-50 text-amber-700",
      };
    default:
      return {
        label: status,
        dotClass: "bg-slate-400",
        chipClass: "bg-slate-100 text-slate-600",
      };
  }
}

/**
 * Pick a per-template accent (subtle background + foreground) so the 8 kit
 * templates are visually distinguishable in the gallery without leaning on
 * heavy color blocks. Falls back to slate.
 */
export function templateAccent(code: string): { iconBg: string; iconText: string } {
  // Hash on the code so two templates with the same first letter don't
  // accidentally share an accent, while runs stay deterministic.
  const map: Record<string, { iconBg: string; iconText: string }> = {
    BRD: { iconBg: "bg-blue-50", iconText: "text-blue-600" },
    PRD: { iconBg: "bg-indigo-50", iconText: "text-indigo-600" },
    CR: { iconBg: "bg-amber-50", iconText: "text-amber-600" },
    DBDD: { iconBg: "bg-emerald-50", iconText: "text-emerald-600" },
    DDD: { iconBg: "bg-violet-50", iconText: "text-violet-600" },
    FSD: { iconBg: "bg-sky-50", iconText: "text-sky-600" },
    SOD: { iconBg: "bg-rose-50", iconText: "text-rose-600" },
    PERSONAS: { iconBg: "bg-cyan-50", iconText: "text-cyan-600" },
  };
  return map[code.toUpperCase()] ?? { iconBg: "bg-slate-100", iconText: "text-slate-600" };
}
