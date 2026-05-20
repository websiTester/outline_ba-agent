/**
 * JobView (Layout B3) — split layout for an active or completed job.
 *
 * Left pane = SectionList sidebar with all sections + their live status.
 * Right pane = SectionDetail showing the currently-selected section.
 * Header bar = title + progress badge + Cancel + Open-in-Outline links.
 */

import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import { Link, useHistory, useParams } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import useStores from "~/hooks/useStores";
import { useJobPolling } from "../hooks/useJobPolling";
import { jobProgressPercent } from "../utils/sectionState";
import SectionDetail from "../components/SectionDetail";
import SectionList from "../components/SectionList";

// Time before auto-redirecting away from a deleted job (Q6 — long enough that
// the user can read the message, short enough that they don't sit there).
const NOT_FOUND_REDIRECT_MS = 5000;

function JobView() {
  const { jobId } = useParams<{ jobId: string }>();
  const history = useHistory();
  const { baKit } = useStores();
  // step 1: start polling immediately; the hook returns the latest JobDetail
  // straight from React state so re-renders are guaranteed on every tick
  // (MobX `@observable.ref` reassigned from an async setTimeout misses
  //  observer notifications in this stack — see hook docstring).
  const job = useJobPolling(jobId);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Auto-redirect when the job is gone (deleted from another tab / by ops).
  // We only set the timer once `currentJobNotFound` flips true; cleanup
  // cancels it if the user navigates away manually first.
  useEffect(() => {
    if (!baKit.currentJobNotFound) {
      return;
    }
    const timer = window.setTimeout(() => {
      history.replace("/ba-kit");
    }, NOT_FOUND_REDIRECT_MS);
    return () => window.clearTimeout(timer);
  }, [baKit.currentJobNotFound, history]);

  // Debug: confirm JobView re-renders + which section/status we have.
  // eslint-disable-next-line no-console
  console.log(
    "[BAKit JobView] render",
    job
      ? {
          jobStatus: job.status,
          selectedId,
          selectedStatus:
            job.sections.find((s) => s.id === selectedId)?.status ?? null,
          sectionsCount: job.sections.length,
        }
      : { job: null }
  );

  // step 2: auto-select the most interesting section: awaiting → running → first pending → first
  useEffect(() => {
    if (!job || selectedId) {
      return;
    }
    const priority =
      job.sections.find((s) => s.status === "awaiting_input") ||
      job.sections.find((s) => s.status === "running") ||
      job.sections.find((s) => s.status === "pending") ||
      job.sections[0];
    if (priority) {
      setSelectedId(priority.id);
    }
  }, [job, selectedId]);

  if (!job) {
    // Special-case 404: render the dedicated "deleted" screen with a link
    // back to the BA Kit home. The redirect timer fires from useEffect above.
    if (baKit.currentJobNotFound) {
      return (
        <div className="w-full max-w-7xl mx-auto py-16 px-8 text-center">
          <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            This job no longer exists
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            It may have been deleted. Redirecting in a few seconds…
          </p>
          <Link
            to="/ba-kit"
            className="inline-flex items-center mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Back to BA Kit
          </Link>
        </div>
      );
    }
    return (
      // Width is forced because the parent Layout's <Content> uses
      // `justify-content: center` (see app/components/Layout.tsx). Without
      // `w-full` the child collapses to its content size and ends up centered
      // narrowly, producing inconsistent widths between empty and filled states.
      <div className="w-full max-w-7xl mx-auto py-10 px-8 text-sm text-slate-400">
        {baKit.currentJobError ?? "Loading job…"}
      </div>
    );
  }

  const selected = job.sections.find((s) => s.id === selectedId) ?? null;
  const pct = jobProgressPercent(job);

  return (
    // `w-full max-w-7xl mx-auto` forces a consistent width regardless of the
    // right-pane content (parent Layout flex-centers children — see comment
    // in the loading branch above).
    <div className="flex flex-col h-full w-full max-w-7xl mx-auto">
      {/* Header bar (matches Layout B3 header) */}
      <header className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">BA Kit · job</p>
          <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100 truncate">
            {job.documentTitle}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{pct}% complete</span>
          {job.outlineDocumentId && (
            <a
              href={`/doc/${job.outlineDocumentId}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-blue-500 hover:underline"
            >
              <ExternalLink size={12} /> Open in Outline
            </a>
          )}
          {/* The job-level "Cancel job" button moved to a per-section Stop
              button inside SectionDetail.tsx — only the running section is
              actually burning Gemini tokens, so cancellation lives there. */}
        </div>
      </header>

      {/* Split body */}
      <div className="flex-1 flex min-h-0">
        <aside className="w-72 shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-y-auto">
          <SectionList
            sections={job.sections}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </aside>
        {/* `min-w-0` prevents shrink-wrap when content is short; combined
            with `flex-1` it always claims remaining horizontal space. */}
        <main className="flex-1 min-w-0 overflow-y-auto px-8 py-6">
          {selected ? (
            <>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-4">
                {selected.title}
              </h2>
              <SectionDetail job={job} section={selected} />
            </>
          ) : (
            <p className="text-sm text-slate-400">Select a section to view its content.</p>
          )}
        </main>
      </div>
    </div>
  );
}

export default observer(JobView);
