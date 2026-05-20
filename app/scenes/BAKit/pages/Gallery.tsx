/**
 * BA Kit landing page (Layout B1).
 *
 * Two sections in a single column:
 *   1. Templates gallery — the action surface
 *   2. Recent jobs — the discovery surface
 *
 * Hosts the StartFormDialog so card clicks can open it without losing scroll
 * position, plus the EmptyContextWarningDialog for the CONTEXT_EMPTY retry
 * flow (Q34).
 */

import { observer } from "mobx-react";
import { useState } from "react";
import { useHistory } from "react-router-dom";
import CenteredContent from "~/components/CenteredContent";
import PageTitle from "~/components/PageTitle";
import EmptyContextWarningDialog from "../components/EmptyContextWarningDialog";
import RecentJobsList from "../components/RecentJobsList";
import StartFormDialog from "../components/StartFormDialog";
import TemplateGallery from "../components/TemplateGallery";
import type { TemplateSummary } from "../types";

function Gallery() {
  const history = useHistory();
  // step 1: track which template (if any) is currently being started
  const [activeTemplate, setActiveTemplate] = useState<TemplateSummary | null>(null);
  // step 2: warning modal state — holds the retry callback returned by StartFormDialog
  const [warningRetry, setWarningRetry] = useState<
    ((force: boolean) => Promise<void>) | null
  >(null);

  return (
    <CenteredContent>
      <PageTitle title="BA Kit" />
      <div className="py-12 px-8 max-w-6xl mx-auto w-full">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="mb-10">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            BA Kit
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 max-w-2xl">
            Generate FIS-style BA artifacts (BRD, PRD, SOD, …) from your
            workspace knowledge graph.
          </p>
        </header>

        {/* ── Templates ──────────────────────────────────────────────────── */}
        <section className="mb-12">
          <SectionHeader title="Templates" />
          <TemplateGallery onStart={(t) => setActiveTemplate(t)} />
        </section>

        {/* ── Recent jobs ────────────────────────────────────────────────── */}
        <section>
          <SectionHeader title="Recent jobs" subtitle="Your last 10 runs" />
          <RecentJobsList />
        </section>
      </div>

      <StartFormDialog
        template={activeTemplate}
        open={!!activeTemplate}
        onClose={() => setActiveTemplate(null)}
        onStarted={(jobId) => {
          // step 3: navigate straight to JobView so user watches sections appear live
          setActiveTemplate(null);
          history.push(`/ba-kit/jobs/${jobId}`);
        }}
        onContextEmpty={(retry) => setWarningRetry(() => retry)}
      />

      <EmptyContextWarningDialog
        open={!!warningRetry}
        onClose={() => setWarningRetry(null)}
        onProceed={async () => {
          if (warningRetry) await warningRetry(true);
          setWarningRetry(null);
        }}
      />
    </CenteredContent>
  );
}

/** Lightweight section header — semibold instead of uppercase tracking. */
function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

export default observer(Gallery);
