/**
 * Inline form rendered when a section is `awaiting_input` (Layout C).
 *
 * The agent paused with 1-3 specific questions. User can answer them and
 * resume, or skip the section entirely (Q31).
 *
 * Visual language: minimal — white card, slate borders, one blue accent for
 * the primary CTA. No decorative icons; round counter is a small text label.
 *
 * Concurrency: once the user successfully submits / skips, the form stays
 * locked (buttons disabled + textareas readonly) until the section's status
 * flips away from `awaiting_input` and the parent unmounts this component.
 * This prevents double-clicks while the FE waits for the next poll to surface
 * the new `running` state.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

type Props = {
  questions: string[];
  // Existing user answers from a previous round (Q&A index → text)
  initialAnswers?: Record<string, string>;
  // Round counter so user knows how many tries are left (max 3 — Q27).
  roundsSoFar?: number;
  maxRounds?: number;
  onSubmit: (answers: Record<string, string>) => Promise<void>;
  onSkip: () => Promise<void>;
};

const DEFAULT_MAX_ROUNDS = 3;

export default function NeedInfoForm({
  questions,
  initialAnswers,
  roundsSoFar,
  maxRounds = DEFAULT_MAX_ROUNDS,
  onSubmit,
  onSkip,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [skipping, setSkipping] = useState(false);

  // Content-based key for the question set. JSON serialized from FastAPI on
  // every poll = new array reference even when the text is identical, so we
  // can't depend on `questions` (or `initialAnswers`) directly — it would
  // wipe the user's in-progress typing every 1.5s. The key only changes
  // when the actual question text changes (i.e., a brand-new round).
  const questionsKey = questions.join("");

  // Reset answers only when a genuinely new question set arrives. `initialAnswers`
  // is intentionally omitted from deps — it's used as a one-shot seed and
  // would otherwise re-fire on every poll for the same reason.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setAnswers(initialAnswers ?? {});
  }, [questionsKey]);

  // Submit enabled only when at least one answer has content
  const anyAnswered = Object.values(answers).some((v) => v.trim().length > 0);
  const isLastRound =
    typeof roundsSoFar === "number" && roundsSoFar >= maxRounds - 1;

  // Once any action is in-flight the whole form is locked — prevents the user
  // hammering the button while AI re-runs on the backend.
  const locked = submitting || skipping;

  const handleSubmit = async () => {
    if (locked || !anyAnswered) return;
    setSubmitting(true);
    try {
      await onSubmit(answers);
      // Intentionally do NOT setSubmitting(false): we want the lock to remain
      // until the parent re-renders with a different status (component then
      // unmounts). The brief window between API resolution and the next poll
      // would otherwise re-enable the button and allow double submission.
    } catch (err) {
      // Restore the form so the user can retry / edit / cancel.
      setSubmitting(false);
      throw err;
    }
  };

  const handleSkip = async () => {
    if (locked) return;
    setSkipping(true);
    try {
      await onSkip();
      // Same logic as submit — keep locked until the section status changes
      // upstream and the component unmounts naturally.
    } catch (err) {
      setSkipping(false);
      throw err;
    }
  };

  return (
    <div
      className="rounded-xl border border-slate-200 bg-white overflow-hidden"
      // Treats Enter inside the answer textareas as plain newlines; submit is
      // only via the button so we don't need an aria-busy on the form itself.
      aria-busy={locked || undefined}
    >
      {/* ── Header — title + round counter ─────────────────────────────── */}
      <header className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">
            AI cần thêm thông tin
          </h3>
          {typeof roundsSoFar === "number" && (
            // Plain text rather than a chip — calmer, less attention-grabbing
            <span
              className={`text-[11px] font-medium ${
                isLastRound ? "text-rose-600" : "text-slate-400"
              }`}
            >
              Round {Math.min(roundsSoFar + 1, maxRounds)} / {maxRounds}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500 leading-relaxed">
          {locked
            ? // Friendly status message once the user has committed an action
              "Đang gửi câu trả lời và chạy lại agent — vui lòng đợi…"
            : "Trả lời để agent tiếp tục, hoặc bỏ qua section này."}
        </p>
      </header>

      {/* ── Question list — plain numbered, no per-row card ────────────── */}
      <ol className="px-5 py-5 space-y-4">
        {questions.map((q, idx) => (
          <li key={idx}>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              <span className="text-slate-400 tabular-nums mr-1.5">
                {idx + 1}.
              </span>
              {q}
            </label>
            <textarea
              value={answers[String(idx)] ?? ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [String(idx)]: e.target.value }))
              }
              rows={2}
              placeholder="Câu trả lời của bạn…"
              // Lock the textareas too once submission is in flight so user
              // can't edit while the request is being processed.
              readOnly={locked}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 read-only:bg-slate-50 read-only:text-slate-500 read-only:cursor-not-allowed transition-colors duration-150"
            />
          </li>
        ))}
      </ol>

      {/* ── Footer — actions right-aligned ─────────────────────────────── */}
      <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
        <button
          type="button"
          onClick={handleSkip}
          disabled={locked}
          className="px-3 py-1.5 text-xs font-medium rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        >
          {skipping ? "Skipping…" : "Skip section"}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!anyAnswered || locked}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </footer>
    </div>
  );
}
