/**
 * Templates tab (Layout A1) — table of every template + upload affordance.
 *
 * Admin can:
 *   - Upload a new `.md` template
 *   - Toggle enabled / disabled (changes are global per spec Q12)
 *   - Open a template into the Sections & Agents editor
 *   - Delete (refused if any GenerationJob references the template)
 *
 * Visual language matches the BA Kit gallery: white cards, subtle slate
 * borders, single blue accent.
 */

import { Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import * as api from "~/scenes/BAKit/api";
import type { TemplateSummary } from "~/scenes/BAKit/types";

type Props = {
  templates: TemplateSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
  onRefresh: () => Promise<void>;
};

export default function TemplatesTab({
  templates,
  loading,
  onOpen,
  onRefresh,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // step 1: upload single .md file (code derived from filename on the server)
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      await api.uploadTemplate(file);
      await onRefresh();
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleToggle = async (t: TemplateSummary) => {
    try {
      await api.toggleTemplate(t.id, !t.isEnabled);
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle");
    }
  };

  const handleDelete = async (t: TemplateSummary) => {
    if (!window.confirm(`Delete ${t.code}? This cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteTemplate(t.id);
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const enabledCount = templates.filter((t) => t.isEnabled).length;
  const disabledCount = templates.length - enabledCount;

  return (
    <div className="space-y-5">
      {/* ── Upload bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border-2 border-dashed border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1"
        >
          <Upload className="h-4 w-4" />
          {uploading ? "Uploading…" : "Upload .md template"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".md"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              void handleUpload(f);
            }
            e.target.value = ""; // allow re-upload same filename
          }}
        />
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>
            <span className="font-semibold text-emerald-600">{enabledCount}</span>{" "}
            enabled
          </span>
          <span className="h-3 w-px bg-slate-200" />
          <span>
            <span className="font-semibold text-slate-500">{disabledCount}</span>{" "}
            disabled
          </span>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-6">
          <p className="text-sm text-slate-400">Loading…</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Template</th>
                <th className="px-5 py-2.5 font-medium w-24">Sections</th>
                <th className="px-5 py-2.5 font-medium w-32">Enabled</th>
                <th className="px-5 py-2.5 font-medium w-44">Last edit</th>
                <th className="px-5 py-2.5 font-medium w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((t) => (
                <tr
                  key={t.id}
                  className="hover:bg-slate-50/60 transition-colors duration-150"
                >
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => onOpen(t.id)}
                      className="text-left cursor-pointer focus:outline-none focus-visible:underline"
                    >
                      <p className="font-semibold text-slate-900">{t.code}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{t.name}</p>
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-medium text-slate-600">
                      {t.section_count}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {/* Toggle: pill switch with smooth slide */}
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={t.isEnabled}
                        onChange={() => handleToggle(t)}
                        className="sr-only peer"
                      />
                      <span className="relative w-9 h-5 bg-slate-200 peer-checked:bg-blue-500 rounded-full transition-colors duration-150">
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-150 ${
                            t.isEnabled ? "translate-x-4" : ""
                          }`}
                        />
                      </span>
                    </label>
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">
                    {new Date(t.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(t)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                      aria-label={`Delete ${t.code}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-10 text-center text-sm text-slate-400"
                  >
                    No templates yet — upload one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
