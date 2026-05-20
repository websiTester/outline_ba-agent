/**
 * Recent jobs list — second block of the BA Kit landing page.
 *
 * Design notes:
 *  - Each row is a flex card with status dot + title block + status chip +
 *    "View →" link aligned right
 *  - Status semantics use shared `jobStatusMeta` so colors stay consistent
 *    with section badges elsewhere
 *  - Relative time keeps the meta line short and scannable
 */

import { observer } from "mobx-react";
import { useEffect } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import useStores from "~/hooks/useStores";
import type { JobSummary } from "../types";
import { jobStatusMeta, relativeTime } from "../utils/formatters";

function RecentJobsList() {
  const { baKit, dialogs } = useStores();

  useEffect(() => {
    void baKit.fetchMyJobs();
  }, [baKit]);

  // Trash button → ConfirmationDialog → store.deleteJob.
  // Outline's `dialogs.openModal` only takes a title + content node, so the
  // confirm submit handler closes the modal on resolve via ConfirmationDialog.
  const handleDeleteClick = (job: JobSummary) => (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    // The row is wrapped in a <Link>-friendly area; stop propagation so the
    // click doesn't accidentally trigger navigation alongside opening the modal.
    event.preventDefault();
    event.stopPropagation();
    dialogs.openModal({
      title: "Delete this job?",
      content: (
        <ConfirmationDialog
          danger
          submitText="Delete"
          savingText="Deleting…"
          onSubmit={async () => {
            try {
              await baKit.deleteJob(job.id);
              toast.success("Job deleted");
            } catch (err) {
              const message =
                err instanceof Error ? err.message : "Failed to delete job";
              toast.error(message);
              throw err; // keep the modal open so user sees the error
            }
          }}
        >
          This will cancel any in-progress generation and remove all section
          states. The linked Outline document will be kept.
        </ConfirmationDialog>
      ),
    });
  };

  // step 1: loading + empty states share the same outer container height
  if (baKit.myJobsLoading && baKit.myJobs.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-6">
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    );
  }
  if (baKit.myJobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-5 py-8 text-center">
        <p className="text-sm text-slate-500">
          No jobs yet — pick a template above to start.
        </p>
      </div>
    );
  }

  // step 2: list of last 10 jobs
  return (
    <ul className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
      {baKit.myJobs.slice(0, 10).map((job) => {
        const status = jobStatusMeta(job.status);
        return (
          <li
            key={job.id}
            // `group` lets the hover-only trash icon use group-hover:* classes.
            className="group flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors duration-150"
          >
            {/* Status dot — color anchored to job.status semantic */}
            <span
              className={`inline-block h-2 w-2 rounded-full ${status.dotClass} shrink-0`}
              aria-hidden="true"
            />

            {/* Title + meta */}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800 truncate">
                {job.documentTitle}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {relativeTime(job.createdAt)}
              </p>
            </div>

            {/* Status chip — pill style with status-tone classes */}
            <span
              className={`hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${status.chipClass}`}
            >
              {status.label}
            </span>

            {/* Trash icon — hidden until row is hovered or button is keyboard-focused.
                Opacity transition rather than display:none so screen readers and
                keyboard users can still reach it via Tab. */}
            <button
              type="button"
              onClick={handleDeleteClick(job)}
              aria-label={`Delete job ${job.documentTitle}`}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 inline-flex items-center justify-center h-7 w-7 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 transition-opacity duration-150"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>

            {/* View link — primary blue accent, sole CTA per row */}
            <Link
              to={`/ba-kit/jobs/${job.id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors duration-150"
            >
              View
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default observer(RecentJobsList);
