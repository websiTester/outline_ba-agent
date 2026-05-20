/**
 * Sections & Agents tab (Layout A2).
 *
 * Two columns:
 *   - Left: section list of the currently-open template
 *   - Right: agent editor for the selected section + few-shot examples
 *
 * Each side is its own card so the seam between navigation and editing is
 * obvious. Save action sits in a footer bar so admins always know where to
 * commit changes.
 */

import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import * as api from "~/scenes/BAKit/api";
import type { SectionDetail, TemplateDetail } from "~/scenes/BAKit/types";

type Props = {
  template: TemplateDetail;
  loading: boolean;
  // Parent calls API to refresh detail after a mutation
  onUpdated: () => Promise<void>;
};

export default function SectionsTab({ template, loading, onUpdated }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    template.sections[0]?.id ?? null
  );
  const selected = template.sections.find((s) => s.id === selectedId) ?? null;

  // Keep selection valid when template changes
  useEffect(() => {
    if (!selectedId || !template.sections.some((s) => s.id === selectedId)) {
      setSelectedId(template.sections[0]?.id ?? null);
    }
  }, [template, selectedId]);

  return (
    <div className="flex gap-6 items-start">
      {/* ── Left: section list ──────────────────────────────────────────── */}
      {/* Widened from w-64 → w-72 now that the scene spans up to screen-2xl
          — long section titles ("Constraints, assumptions, dependencies")
          no longer wrap awkwardly. */}
      <aside className="w-72 shrink-0 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Sections
          </p>
          <span className="text-[11px] text-slate-400">
            {template.sections.length}
          </span>
        </div>
        <ul className="divide-y divide-slate-100">
          {template.sections.map((s) => {
            // Roman numeral + title are stored together in section.title
            // (e.g. "I. Tổng quan"). Split for a subtle two-tone display.
            const [roman, ...rest] = s.title.split(". ");
            const titleText = rest.length ? rest.join(". ") : s.title;
            const isActive = selectedId === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={`group w-full text-left px-3 py-2.5 text-sm transition-colors duration-150 cursor-pointer flex items-start gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-inset ${isActive
                    ? "bg-blue-50/70 text-blue-700"
                    : "hover:bg-slate-50 text-slate-700"
                    }`}
                >
                  <span
                    className={`mt-0.5 text-[11px] font-mono tabular-nums ${isActive ? "text-blue-500" : "text-slate-400"
                      }`}
                  >
                    {roman}.
                  </span>
                  <span className="flex-1 leading-snug">{titleText}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ── Right: agent editor ─────────────────────────────────────────── */}
      <main className="flex-1 min-w-0">
        {loading && <p className="text-sm text-slate-400">Loading…</p>}
        {!loading && selected && (
          <AgentEditor
            section={selected}
            templateId={template.id}
            onSaved={onUpdated}
          />
        )}
      </main>
    </div>
  );
}

/**
 * Inline editor for one section's agent + its examples.
 * Renders inside a single card with a sticky-feeling action footer.
 */
function AgentEditor({
  section,
  templateId,
  onSaved,
}: {
  section: SectionDetail;
  templateId: string;
  onSaved: () => Promise<void>;
}) {
  const [model, setModel] = useState(section.agent?.model ?? "gemini-2.5-flash");
  const [systemPrompt, setSystemPrompt] = useState(section.agent?.systemPrompt ?? "");
  const [instruction, setInstruction] = useState(section.agent?.instruction ?? "");
  const [saving, setSaving] = useState(false);

  // Reset local form when admin switches to a different section
  useEffect(() => {
    setModel(section.agent?.model ?? "gemini-2.5-flash");
    setSystemPrompt(section.agent?.systemPrompt ?? "");
    setInstruction(section.agent?.instruction ?? "");
  }, [section.id]);

  // Detect unsaved changes so the save button can lean in (color stays the
  // same to keep the surface calm — just enabled vs. faded).
  const dirty =
    model !== (section.agent?.model ?? "gemini-2.5-flash") ||
    systemPrompt !== (section.agent?.systemPrompt ?? "") ||
    instruction !== (section.agent?.instruction ?? "");

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateSectionAgent(templateId, section.id, {
        model,
        systemPrompt,
        instruction,
      });
      await onSaved();
      toast.success("Agent saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Agent config card ───────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white">
        {/* Header */}
        <header className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Edit the agent prompt + model for this section. Changes apply to new jobs.
          </p>
        </header>

        {/* Form body */}
        <div className="px-5 py-5 space-y-5">
          <Field label="Model" hint="Per-section model selection.">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 transition-colors duration-150 cursor-pointer"
            >
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            </select>
          </Field>

          <Field
            label="System prompt"
            hint="Sent verbatim to the LLM. Use the `body_template` markers as the structural contract."
          >
            {/* Code-editor styling: darker slate-900 text on a slightly tinted
                slate-100 background gives the textarea a clear "this is
                source-of-truth markdown" feel — closer to a `<pre>` block
                than a regular text input. Explicit monospace stack ensures
                consistent rendering across OS. Tab key inserts spaces (handled
                in onKeyDown) so admins editing prompt structure don't lose
                focus. */}
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  e.preventDefault();
                  const target = e.currentTarget;
                  const start = target.selectionStart;
                  const end = target.selectionEnd;
                  const next =
                    systemPrompt.slice(0, start) + "  " + systemPrompt.slice(end);
                  setSystemPrompt(next);
                  // Restore caret position after the inserted spaces.
                  requestAnimationFrame(() => {
                    target.selectionStart = target.selectionEnd = start + 2;
                  });
                }
              }}
              rows={16}
              spellCheck={false}
              wrap="soft"
              className="w-full rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-[13px] font-mono leading-[1.65] tracking-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 focus:bg-white transition-colors duration-150 selection:bg-blue-200/60"
              style={{
                fontFamily:
                  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
                tabSize: 2,
              }}
            />
          </Field>

          <Field
            label="Instruction"
            hint="User-facing summary shown next to the section in the run UI."
          >
            {/* Matches the System prompt textarea — code-editor feel with a
                tinted slate-100 background + monospace + Tab → 2-space behavior.
                Shorter (rows=5) since this is a 1-3 sentence summary, not a
                multi-paragraph prompt. */}
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  e.preventDefault();
                  const target = e.currentTarget;
                  const start = target.selectionStart;
                  const end = target.selectionEnd;
                  const next =
                    instruction.slice(0, start) + "  " + instruction.slice(end);
                  setInstruction(next);
                  requestAnimationFrame(() => {
                    target.selectionStart = target.selectionEnd = start + 2;
                  });
                }
              }}
              rows={5}
              spellCheck={false}
              wrap="soft"
              className="w-full rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-[13px] font-mono leading-[1.65] tracking-tight text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400 focus:bg-white transition-colors duration-150 selection:bg-blue-200/60"
              style={{
                fontFamily:
                  "ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
                tabSize: 2,
              }}
            />
          </Field>
        </div>

        {/* Action footer */}
        <footer className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/40 rounded-b-xl">
          {dirty && (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </section>

      {/* ── Examples card ───────────────────────────────────────────────── */}
      <ExamplesEditor
        section={section}
        templateId={templateId}
        onSaved={onSaved}
      />
    </div>
  );
}

/** Field row — vertical label + helper text above the control. */
function Field({
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
      <div className="mb-1.5">
        <label className="block text-xs font-semibold text-slate-700">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Few-shot examples editor (Q42) — up to 2 examples per section.
 */
function ExamplesEditor({
  section,
  templateId,
  onSaved,
}: {
  section: SectionDetail;
  templateId: string;
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const canAdd = section.examples.length < 2 && label.trim() && content.trim();

  const handleAdd = async () => {
    setBusy(true);
    try {
      await api.addSectionExample(templateId, section.id, label.trim(), content);
      await onSaved();
      setLabel("");
      setContent("");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (exampleId: string) => {
    if (!window.confirm("Remove this example?")) {
      return;
    }
    await api.removeSectionExample(templateId, section.id, exampleId);
    await onSaved();
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Few-shot examples
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Optional samples injected into the prompt to anchor output style (max 2).
          </p>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-[11px] font-medium text-slate-600">
          {section.examples.length}/2
        </span>
      </header>

      <div className="px-5 py-5 space-y-4">
        {/* Existing examples */}
        {section.examples.length > 0 && (
          <ul className="space-y-2">
            {section.examples.map((ex) => (
              <li
                key={ex.id}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/30 px-3 py-2.5 hover:bg-slate-50 transition-colors duration-150"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{ex.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">
                    {ex.content}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(ex.id)}
                  className="text-slate-400 hover:text-rose-500 cursor-pointer transition-colors duration-150"
                  aria-label="Remove example"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Add form — only visible when room for more */}
        {section.examples.length < 2 ? (
          // Use flex column + gap-3 (12px) for the inter-field spacing.
          // Gap on a flex container is more reliable than per-element margins
          // — no collapse, no normalize reset, no Tailwind purge edge cases.
          <div className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/30 px-3 py-3">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (e.g. SSO PRD)"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 transition-colors duration-150"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="Example markdown content…"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300 transition-colors duration-150"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleAdd}
                disabled={!canAdd || busy}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150"
              >
                <Plus className="h-3.5 w-3.5" />
                {busy ? "Adding…" : "Add example"}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-400 text-center py-2">
            Maximum reached. Remove one to add another.
          </p>
        )}
      </div>
    </section>
  );
}
