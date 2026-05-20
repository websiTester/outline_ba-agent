/**
 * Template gallery — landing-page grid of available templates (B1).
 *
 * Design notes (flat-minimal, single blue accent):
 *  - 4-col grid on desktop, collapses naturally on smaller widths
 *  - Each card has a colored icon chip per template code (templateAccent)
 *    so users can scan by visual hue rather than reading every label
 *  - Markdown markers are stripped from the description so the card body
 *    stays readable
 *  - Whole card is clickable (cursor-pointer + onClick) — the trailing Start
 *    button is kept as an affordance but the click target is the card
 *  - Hover: subtle border + bg shift, no scale transform (avoids layout
 *    shift per UX guideline)
 */

import { observer } from "mobx-react";
import { useEffect } from "react";
import { FileText, ArrowRight } from "lucide-react";
import useStores from "~/hooks/useStores";
import type { TemplateSummary } from "../types";
import { stripMarkdownPreview, templateAccent } from "../utils/formatters";

type Props = {
  onStart: (template: TemplateSummary) => void;
};

function TemplateGallery({ onStart }: Props) {
  const { baKit } = useStores();

  // Pull templates once on mount; refetch is opt-in via store.
  useEffect(() => {
    void baKit.fetchTemplates();
  }, [baKit]);

  // step 1: loading + error + empty states share the same wrapper so the
  // section height doesn't jump as data arrives
  if (baKit.templatesLoading && baKit.templates.length === 0) {
    return <EmptyState label="Loading templates…" />;
  }
  if (baKit.templatesError) {
    return (
      <EmptyState
        label={`Failed to load templates: ${baKit.templatesError}`}
        tone="error"
      />
    );
  }
  if (baKit.templates.length === 0) {
    return (
      <EmptyState label="No templates enabled. Ask your instance admin to enable one in Settings → BA Kit Admin." />
    );
  }

  // step 2: render the 4-col grid; cards self-equalize via flex-col + mt-auto footer
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {baKit.templates.map((t) => (
        <TemplateCard key={t.id} template={t} onStart={() => onStart(t)} />
      ))}
    </div>
  );
}

function TemplateCard({
  template,
  onStart,
}: {
  template: TemplateSummary;
  onStart: () => void;
}) {
  const accent = templateAccent(template.code);
  const description = stripMarkdownPreview(template.description) || template.name;

  return (
    <button
      type="button"
      onClick={onStart}
      // step a: full-card click target. role=button + keyboard support via the
      // <button> element itself; outline focus ring kept visible for a11y.
      className="group relative flex flex-col text-left rounded-xl border border-slate-200 bg-white p-5 cursor-pointer transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1"
    >
      {/* Top row: colored icon chip + template code */}
      <div className="flex items-center gap-3 mb-3">
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${accent.iconBg}`}
          aria-hidden="true"
        >
          <FileText className={`h-4 w-4 ${accent.iconText}`} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 leading-none">
            {template.code}
          </p>
          <p className="mt-1 text-[11px] text-slate-400 truncate">{template.name}</p>
        </div>
      </div>

      {/* Description — clamped to 2 lines so cards stay uniform height */}
      <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-5 min-h-[2.5rem]">
        {description}
      </p>

      {/* Footer: section count chip + Start affordance */}
      <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-100">
        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-medium text-slate-600">
          {template.section_count} sections
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 transition-transform duration-150 group-hover:translate-x-0.5">
          Start
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}

/** Centered placeholder used for loading / error / empty cases. */
function EmptyState({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "muted" | "error";
}) {
  const color = tone === "error" ? "text-rose-500" : "text-slate-500";
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 py-8 px-6">
      <p className={`text-sm ${color}`}>{label}</p>
    </div>
  );
}

export default observer(TemplateGallery);
