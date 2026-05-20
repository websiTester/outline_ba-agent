/**
 * Left-pane section sidebar in JobView (Layout B3).
 *
 * One row per section: order, title, status icon, and a stale-badge when
 * applicable (Q29). Selecting a row updates the parent's `selectedId`.
 */

import type { SectionStateDTO } from "../types";
import { displayForStatus, isSectionStale } from "../utils/sectionState";

// Tiny local classnames helper — avoids pulling in the `clsx` package just
// for two `cn(...)` call sites in this file.
function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Props = {
  sections: SectionStateDTO[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const TONE_CLASSES: Record<string, string> = {
  muted: "text-slate-400",
  info: "text-blue-500",
  warning: "text-amber-500",
  success: "text-emerald-500",
  danger: "text-rose-500",
  neutral: "text-slate-500",
};

export default function SectionList({ sections, selectedId, onSelect }: Props) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {sections.map((s) => {
        const disp = displayForStatus(s.status);
        const stale = isSectionStale(s, sections);
        const selected = s.id === selectedId;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 flex items-start gap-2 transition-colors",
                selected
                  ? "bg-blue-50 dark:bg-slate-800"
                  : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
              )}
            >
              <span className={cn("text-base leading-none mt-0.5", TONE_CLASSES[disp.tone])}>
                {disp.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate text-slate-800 dark:text-slate-100">
                  {s.title}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                  <span>{disp.label}</span>
                  {stale && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px]">
                      may be stale
                    </span>
                  )}
                </p>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
