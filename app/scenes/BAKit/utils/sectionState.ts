/**
 * Display helpers for section state.
 *
 * Centralises icon/color/label decisions so SectionList + SectionDetail stay
 * in sync. Also exposes `isStale` to mark §X+1.. when §X was regenerated
 * after job completion (Q29).
 */

import type {
  JobDetail,
  SectionStateDTO,
  SectionStatus,
} from "../types";

// Map status → user-facing label + UI tint key (consumed by Tailwind classes)
export type StatusDisplay = {
  label: string;
  // Icon character / glyph to render in the section list sidebar
  icon: string;
  // Coarse tone bucket so consumers can pick their own color class
  tone: "muted" | "info" | "warning" | "success" | "danger" | "neutral";
};

const STATUS_TABLE: Record<SectionStatus, StatusDisplay> = {
  pending: { label: "Pending", icon: "○", tone: "muted" },
  running: { label: "Running…", icon: "●", tone: "info" },
  awaiting_input: { label: "Awaiting input", icon: "⏸", tone: "warning" },
  done: { label: "Done", icon: "✓", tone: "success" },
  done_unsynced: {
    label: "Done (sync failed)",
    icon: "✓⚠",
    tone: "warning",
  },
  skipped: { label: "Skipped", icon: "⊘", tone: "muted" },
  error: { label: "Error", icon: "✕", tone: "danger" },
};

/**
 * Pick a user-friendly label + icon for the given section status.
 */
export function displayForStatus(status: SectionStatus): StatusDisplay {
  return STATUS_TABLE[status] ?? STATUS_TABLE.pending;
}

/**
 * A section is considered stale when an earlier (lower-order) section was
 * regenerated AFTER this one completed (Q29). We approximate this by
 * comparing `completedAt` timestamps: if any earlier done section completed
 * later than this section, this one's content may reference outdated info.
 */
export function isSectionStale(
  section: SectionStateDTO,
  allSections: SectionStateDTO[]
): boolean {
  if (section.status !== "done" && section.status !== "done_unsynced") {
    return false;
  }
  if (!section.completedAt) return false;
  const myTime = new Date(section.completedAt).getTime();
  return allSections.some((other) => {
    if (other.orderIndex >= section.orderIndex) return false;
    if (other.status !== "done" && other.status !== "done_unsynced") return false;
    if (!other.completedAt) return false;
    return new Date(other.completedAt).getTime() > myTime;
  });
}

/**
 * Percentage of sections in a terminal-OK state (done / done_unsynced / skipped).
 * Used by the JobView header bar progress badge.
 */
export function jobProgressPercent(job: JobDetail): number {
  if (!job.sections.length) return 0;
  const terminal = job.sections.filter(
    (s) =>
      s.status === "done" ||
      s.status === "done_unsynced" ||
      s.status === "skipped"
  ).length;
  return Math.round((terminal / job.sections.length) * 100);
}

/**
 * Whether the job is in a state where polling should continue.
 */
export function isJobActive(job: JobDetail | null): boolean {
  if (!job) return false;
  return (
    job.status === "pending" ||
    job.status === "running" ||
    job.status === "awaiting_input"
  );
}
