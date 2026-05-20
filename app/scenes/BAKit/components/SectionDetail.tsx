/**
 * Right-pane content view in JobView.
 *
 * Renders the current section based on status:
 *   - pending          → placeholder
 *   - running          → spinner + label
 *   - done / done_unsynced / skipped → markdown preview + Regenerate button
 *   - awaiting_input   → NeedInfoForm (Q13)
 *   - error            → error message + Retry button (Q30)
 */

import { Loader2, Play, RefreshCw, Square } from "lucide-react";
import { observer } from "mobx-react";
import { useState } from "react";
import useStores from "~/hooks/useStores";
import type { JobDetail, SectionStateDTO } from "../types";
import NeedInfoForm from "./NeedInfoForm";

type Props = {
  job: JobDetail;
  section: SectionStateDTO;
};

function SectionDetail({ job, section }: Props) {
  const { baKit } = useStores();

  // Local lock so an admin can't fire `regenerateSection` again before the
  // previous call finishes — the backend would then race two generations for
  // the same section.
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    if (isRetrying) {
      return;
    }
    setIsRetrying(true);
    try {
      await baKit.regenerateSection(job.id, section.sectionId);
    } finally {
      setIsRetrying(false);
    }
  };

  // Per-section Stop. Blocks double-click while the cancel round-trip is in
  // flight; the button branch unmounts once the section's status flips to
  // `error` (with USER_STOPPED) on the next poll.
  const [isStopping, setIsStopping] = useState(false);

  const handleStop = async () => {
    if (isStopping) {
      return;
    }
    setIsStopping(true);
    try {
      await baKit.stopSection(job.id, section.sectionId);
    } finally {
      setIsStopping(false);
    }
  };

  // Debug: confirms this child re-renders with up-to-date section status.
  // eslint-disable-next-line no-console
  console.log("[BAKit SectionDetail] render", {
    sectionId: section.id,
    status: section.status,
    hasContent: !!section.content,
    needInfoCount: section.needInfoQuestions?.length ?? 0,
  });

  // step 1: simple states first — pending / running placeholders
  if (section.status === "pending") {
    // Find the section immediately before this one in the template ordering.
    // Only offer the manual "Generate now" escape hatch once that upstream
    // section has actually finished — otherwise we'd race the queue.
    const previousSection = job.sections
      .filter((s) => s.orderIndex < section.orderIndex)
      .sort((a, b) => b.orderIndex - a.orderIndex)[0];
    const previousReady =
      !previousSection ||
      previousSection.status === "done" ||
      previousSection.status === "done_unsynced" ||
      previousSection.status === "skipped";

    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-400">
          Pending — will start after earlier sections complete.
        </p>
        {previousReady && (
          <div>
            <button
              onClick={handleRetry}
              // `isRetrying` blocks double-clicks while the regenerate call is
              // in flight; once it returns and the section transitions out of
              // `pending`, this whole branch unmounts.
              disabled={isRetrying}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isRetrying ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              {isRetrying ? "Generating…" : "Generate now"}
            </button>
          </div>
        )}
      </div>
    );
  }
  if (section.status === "running") {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-blue-500 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Generating…
        </p>
        {/* Stop button — cancels the in-flight Gemini call to save tokens.
            Disabled while the cancel round-trip is itself in flight. */}
        <button
          onClick={handleStop}
          disabled={isStopping}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-rose-200 text-rose-500 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isStopping ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Square size={12} />
          )}
          {isStopping ? "Stopping…" : "Stop"}
        </button>
      </div>
    );
  }

  // step 2: awaiting_input → inline form (Q13)
  if (section.status === "awaiting_input") {
    const questions = section.needInfoQuestions ?? [];
    return (
      <NeedInfoForm
        questions={questions}
        initialAnswers={section.userAnswers ?? {}}
        // Pass round count so the form can warn user when on the last round
        // (Q27 — after round 3 agent must force-generate).
        roundsSoFar={section.needInfoRounds}
        onSubmit={async (answers) => {
          await baKit.submitAnswer(job.id, section.sectionId, answers, false);
        }}
        onSkip={async () => {
          await baKit.submitAnswer(job.id, section.sectionId, {}, true);
        }}
      />
    );
  }

  // step 3: error state — has a soft sub-branch when the "error" is just the
  // user clicking Stop. We don't want a red Error label after a deliberate
  // user action; render slate-toned with friendlier copy + a "Generate again"
  // button (same regenerate flow as real Retry).
  if (section.status === "error") {
    const isUserStopped = section.errorCode === "USER_STOPPED";
    const containerClass = isUserStopped
      ? "rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-900/10 p-4"
      : "rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-900/10 p-4";
    const titleClass = isUserStopped
      ? "text-sm font-medium text-slate-700 mb-1"
      : "text-sm font-medium text-rose-700 mb-1";
    const buttonClass = isUserStopped
      ? "flex items-center gap-1 px-3 py-1.5 text-xs rounded-md text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
      : "flex items-center gap-1 px-3 py-1.5 text-xs rounded-md text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-60 disabled:cursor-not-allowed";
    const title = isUserStopped
      ? "Section stopped"
      : `Error: ${section.errorCode ?? "Unknown"}`;
    const body = isUserStopped
      ? "Generation was cancelled before completion."
      : section.errorMessage ??
        "Something went wrong while generating this section.";
    const idleLabel = isUserStopped ? "Generate again" : "Retry section";
    const busyLabel = isUserStopped ? "Generating…" : "Retrying…";

    return (
      <div className={containerClass}>
        <p className={titleClass}>{title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {body}
        </p>
        <button
          onClick={handleRetry}
          disabled={isRetrying}
          className={buttonClass}
        >
          {isRetrying ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {isRetrying ? busyLabel : idleLabel}
        </button>
      </div>
    );
  }

  // step 4: terminal-OK paths — done / done_unsynced / skipped
  const isUnsynced = section.status === "done_unsynced";
  const isSkipped = section.status === "skipped";

  return (
    <div>
      {isUnsynced && (
        // Q32 — content saved in DB but not pushed to Outline doc; let user retry
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/10 px-3 py-2 text-xs text-amber-700 flex items-center justify-between">
          <span>Generated, but failed to sync to the Outline document.</span>
          <button
            onClick={() => baKit.regenerateSection(job.id, section.sectionId)}
            className="font-medium hover:underline"
          >
            Retry sync
          </button>
        </div>
      )}
      <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
        {section.content ?? ""}
      </pre>
      {!isSkipped && (
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isRetrying ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {isRetrying ? "Regenerating…" : "Regenerate section"}
          </button>
        </div>
      )}
    </div>
  );
}

export default observer(SectionDetail);
