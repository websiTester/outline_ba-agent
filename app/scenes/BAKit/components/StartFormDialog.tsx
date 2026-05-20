/**
 * Modal Start form (Layout B2) — collects title, collection, optional files,
 * free-text context, and the AI hint. On submit the parent triggers
 * `BAKitStore.startJob` and navigates to the JobView page.
 *
 * Pre-flight: when the backend returns `CONTEXT_EMPTY` (Q34) the parent should
 * show the EmptyContextWarningDialog before retrying with `force_proceed=true`.
 *
 * Visual language matches the rest of BA Kit: white card, slate borders, a
 * single blue accent for primary actions. Decorative icons are kept to the
 * minimum needed for affordance (Upload icon inside the dropzone, X close,
 * trailing arrow on the primary CTA).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { ArrowRight, Upload, X } from "lucide-react";
import { toast } from "sonner";
import useStores from "~/hooks/useStores";
import { client } from "~/utils/ApiClient";
import type { TemplateSummary } from "../types";

// Q36 — Frontend mirror of backend limits so the user gets immediate feedback.
const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_CHARS = 200_000;

type Props = {
  template: TemplateSummary | null;
  open: boolean;
  onClose: () => void;
  onStarted: (jobId: string) => void;
  /** Called when backend returns warnings.includes('CONTEXT_EMPTY') — parent
   *  decides whether to surface the warning modal. */
  onContextEmpty: (
    retry: (forceProceed: boolean) => Promise<void>
  ) => void;
};

function StartFormDialog({ template, open, onClose, onStarted, onContextEmpty }: Props) {
  const { baKit } = useStores();
  const [title, setTitle] = useState("");
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);
  const [collectionId, setCollectionId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [freeText, setFreeText] = useState("");
  const [userHint, setUserHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Drag state for the file dropzone — toggles visual feedback on hover.
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // step 1: when a template is selected, suggest a default title
  useEffect(() => {
    if (template) {
      const today = new Date().toISOString().slice(0, 10);
      setTitle(`${template.code} - ${today}`);
    }
  }, [template]);

  // step 2: pre-load workspace collections so the picker is populated
  useEffect(() => {
    if (!open) {
      return;
    }
    void (async () => {
      const res = await client.post("/collections.list", { limit: 100 });
      const list = (res?.data ?? []) as Array<{ id: string; name: string }>;
      setCollections(list);
      if (list.length && !collectionId) {
        setCollectionId(list[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Pre-validate file count + size so we don't waste a multipart roundtrip.
  const handleAddFiles = (incoming: FileList | File[] | null) => {
    if (!incoming) {
      return;
    }
    const next = [...files];
    for (const f of Array.from(incoming)) {
      if (next.length >= MAX_FILES) {
        toast.error(`Max ${MAX_FILES} files`);
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name} > 5MB`);
        continue;
      }
      next.push(f);
    }
    setFiles(next);
  };

  const totalChars = useMemo(
    () => freeText.length + userHint.length,
    [freeText, userHint]
  );
  const overChars = totalChars > MAX_TOTAL_CHARS;
  const canSubmit = !!template && !!title.trim() && !!collectionId && !submitting && !overChars;

  // step 3: shared submit logic — used for initial submit + the force-proceed retry
  const doStart = async (forceProceed: boolean) => {
    if (!template) {
      return;
    }
    setSubmitting(true);
    try {
      // step 3a: create the Outline document up front so we have its id (Q10)
      const docRes = await client.post("/documents.create", {
        collectionId,
        title,
        text: "",
        publish: true,
      });
      const outlineDocId = (docRes?.data?.id ?? "") as string;

      // step 3b: fire the job; the engine immediately schedules background work
      const result = await baKit.startJob({
        templateId: template.id,
        documentTitle: title,
        outlineCollectionId: collectionId,
        outlineDocumentId: outlineDocId,
        userHint,
        freeTextContext: freeText,
        forceProceed,
        files,
      });

      // step 3c: backend may signal CONTEXT_EMPTY warning (Q34) — parent handles UX
      if (result.warnings?.includes("CONTEXT_EMPTY") && !forceProceed) {
        onContextEmpty((force) => doStart(force));
        return;
      }
      onStarted(result.jobId);
    } catch (err) {
      // 422 CONTEXT_EMPTY also surfaces as an exception when force_proceed=false
      const message = err instanceof Error ? err.message : "Failed to start job";
      // Heuristic: if the message contains CONTEXT_EMPTY treat as warning path
      if (message.includes("CONTEXT_EMPTY")) {
        onContextEmpty((force) => doStart(force));
        return;
      }
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !template) {
    return null;
  }

  return (
    <div
      // z-index 3000 matches Outline's `depths.modal` (see shared/styles/depths.ts);
      // anything lower lets the sidebar (z-index 900) bleed over the backdrop.
      style={{ zIndex: 3000 }}
      className="fixed inset-0 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        // Stop bubbling so clicks inside the card don't dismiss the modal.
        onClick={(e) => e.stopPropagation()}
        // Cap to 90vh + flex column so the body can scroll internally while
        // header + footer stay pinned. Avoids the form overflowing the viewport.
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
      >
        {/* ── Header (pinned) ────────────────────────────────────────────── */}
        <header className="shrink-0 flex items-start justify-between gap-4 px-8 pt-7 pb-5 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold text-slate-900 tracking-tight">
              Start {template.code}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Tạo {template.code} mới để bắt đầu thu thập và xử lý yêu cầu.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md p-1 transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          >
            <X size={20} />
          </button>
        </header>

        {/* ── Body (scrollable) ──────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 space-y-5">
          {/* Document title */}
          <FieldGroup label="Document title *">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-colors duration-150"
            />
          </FieldGroup>

          {/* Collection */}
          <FieldGroup label="Collection đích *">
            <select
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-colors duration-150"
            >
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FieldGroup>

          {/* Optional files — dropzone */}
          <FieldGroup label={`Optional context files (max ${MAX_FILES} × 5MB)`}>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                handleAddFiles(e.dataTransfer?.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors duration-150 ${
                isDragging
                  ? "border-blue-400 bg-blue-50/60"
                  : "border-slate-200 bg-slate-50/40 hover:bg-slate-50 hover:border-slate-300"
              }`}
            >
              <span className="inline-flex items-center gap-2 text-sm font-medium text-blue-600">
                <Upload className="h-4 w-4" />
                Add files
              </span>
              <span className="text-xs text-slate-400">
                Kéo thả file vào đây hoặc chọn để tải lên
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleAddFiles(e.target.files);
                  e.target.value = ""; // allow re-selecting same file later
                }}
              />
            </div>

            {/* Uploaded files list */}
            {files.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs"
                  >
                    <span className="truncate text-slate-700 flex-1 min-w-0">
                      {f.name}
                      <span className="ml-2 text-slate-400">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="shrink-0 text-slate-400 hover:text-rose-500 cursor-pointer transition-colors duration-150"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FieldGroup>

          {/* Free-text context */}
          <FieldGroup label="Free-text context (optional)">
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              rows={3}
              placeholder="Nhập bối cảnh hoặc thông tin liên quan (nếu có)"
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-colors duration-150"
            />
          </FieldGroup>

          {/* Hint */}
          <FieldGroup label="Hint cho AI (optional)">
            <textarea
              value={userHint}
              onChange={(e) => setUserHint(e.target.value)}
              rows={3}
              placeholder="Cung cấp gợi ý để AI hiểu rõ hơn về tài liệu bạn muốn tạo"
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 transition-colors duration-150"
            />
          </FieldGroup>
        </div>

        {/* ── Footer (pinned) ────────────────────────────────────────────── */}
        <footer className="shrink-0 border-t border-slate-100 px-8 py-4 flex items-center justify-between gap-4">
          <span className={`text-xs ${overChars ? "text-rose-500" : "text-slate-400"}`}>
            {totalChars.toLocaleString()} / {MAX_TOTAL_CHARS.toLocaleString()} chars
            {overChars && " · Exceeds limit"}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => doStart(false)}
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1"
            >
              {submitting ? "Starting…" : "Generate now"}
              {!submitting && <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Label + control wrapper — keeps the form's vertical rhythm consistent
 * (label, helper text, then the control). Helper text slot is implicit
 * via the optional `hint` prop.
 */
function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      {hint && <p className="text-xs text-slate-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

export default observer(StartFormDialog);
