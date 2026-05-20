/**
 * Pre-flight warning surfaced when the backend reports CONTEXT_EMPTY (Q34).
 *
 * User has 2 buttons:
 *   - Cancel        → close the dialog; nothing was started
 *   - Proceed anyway → call the supplied `retry(true)` callback so the parent
 *                      restarts the request with `force_proceed=true`
 */

import { AlertTriangle } from "lucide-react";
import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  // Supplied by StartFormDialog — calls `doStart(true)`.
  onProceed: () => Promise<void>;
};

export default function EmptyContextWarningDialog({ open, onClose, onProceed }: Props) {
  const [busy, setBusy] = useState(false);

  if (!open) {
    return null;
  }

  const handleProceed = async () => {
    setBusy(true);
    try {
      await onProceed();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 shadow-xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Workspace context is empty
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              No documents are indexed in this workspace's knowledge graph and you
              haven't provided any ad-hoc context. AI output will rely heavily on
              <code className="mx-1">[TBD: …]</code> placeholders. Do you want to
              continue anyway?
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleProceed}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40"
          >
            {busy ? "Starting…" : "Proceed anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
