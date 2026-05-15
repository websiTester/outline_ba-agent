import { useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import useStores from "~/hooks/useStores";
import { getAgentTool, upsertAgentTool } from "../api";

interface ToolModalProps {
  open: boolean;
  onClose: () => void;
  sectionId?: string | null;
  label?: string;
  onSaveSuccess?: () => void;
}

const MODEL_OPTIONS = ["gemini-2.5-flash"];

// ── Font loader ──────────────────────────────────────────────────────────────
function useProfessionalFonts() {
  useEffect(() => {
    const id = "tool-modal-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link);
  }, []);
}

// ── Instruction Editor ───────────────────────────────────────────────────────
interface InstructionEditorProps {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}

function InstructionEditor({ value, onChange, disabled }: InstructionEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);

  const lines = value.split("\n");
  const charCount = value.length;
  const tokenEstimate = Math.round(charCount / 4);

  const syncScroll = () => {
    if (lineNumRef.current && textareaRef.current) {
      lineNumRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  return (
    <div
      className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Editor top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-100 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
          </div>
          <span
            className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400 ml-1"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            System Instruction
          </span>
        </div>
        <div
          className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          <span>{charCount.toLocaleString()} chars</span>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <span>~{tokenEstimate.toLocaleString()} tokens</span>
        </div>
      </div>

      {/* Line numbers + textarea */}
      <div className="flex bg-slate-50 dark:bg-slate-900/60" style={{ maxHeight: 480, minHeight: 200 }}>
        {/* Line numbers */}
        <div
          ref={lineNumRef}
          className="overflow-hidden select-none flex-shrink-0 w-10 bg-slate-100 dark:bg-slate-800/60 border-r border-slate-200 dark:border-slate-700 py-2.5 text-right pr-2.5 text-slate-400 dark:text-slate-500"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11.5,
            lineHeight: "20px",
            overflowY: "hidden",
          }}
        >
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          disabled={disabled}
          placeholder="Enter system-level instructions for the agent…"
          className="flex-1 bg-transparent resize-none focus:outline-none py-2.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed placeholder-slate-400 dark:placeholder-slate-600 text-slate-700 dark:text-slate-200"
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12.5,
            lineHeight: "20px",
            overflowY: "auto",
            maxHeight: 480,
            minHeight: 200,
          }}
        />
      </div>
    </div>
  );
}

// ── Field Label ──────────────────────────────────────────────────────────────
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-[10.5px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {children}
    </label>
  );
}

// ── Input shared className ───────────────────────────────────────────────────
const inputCls =
  "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 " +
  "text-slate-800 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 " +
  "px-3.5 py-2.5 text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 " +
  "transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed";

// ── Main component ───────────────────────────────────────────────────────────
function ToolModal({ open, onClose, sectionId, label, onSaveSuccess }: ToolModalProps) {
  const { auth } = useStores();

  const [toolName, setToolName] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [toolDescription, setToolDescription] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useProfessionalFonts();

  useEffect(() => {
    if (!open || !sectionId || !auth.currentTeamId) { return; }

    setIsFetching(true);
    setToolName("");
    setModel("gemini-2.5-flash");
    setToolDescription("");
    setDefaultPrompt("");
    setInstruction("");

    getAgentTool(auth.currentTeamId, sectionId)
      .then((data) => {
        if (data) {
          setToolName(data.toolName ?? "");
          setModel(data.model ?? "gemini-2.5-flash");
          setToolDescription(data.toolDescription ?? "");
          setDefaultPrompt(data.defaultPrompt ?? "");
          setInstruction(data.instruction ?? "");
        }
      })
      .catch(() => toast.error("Failed to load tool configuration."))
      .finally(() => setIsFetching(false));
  }, [open, sectionId, auth.currentTeamId]);

  // Ctrl+Enter to save
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") handleSave();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, toolName, model, toolDescription, defaultPrompt, instruction]);

  const handleSave = async () => {
    if (!sectionId || !auth.currentTeamId) { return; }
    setIsSaving(true);
    try {
      await upsertAgentTool({
        workspaceId: auth.currentTeamId,
        sectionId,
        toolName,
        model,
        toolDescription,
        defaultPrompt,
        instruction,
      });
      toast.success("Tool configuration saved.");
      onSaveSuccess?.();
      onClose();
    } catch {
      toast.error("Failed to save. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!open) { return null; }

  const isDisabled = isFetching || isSaving;

  return (
    <div
      className="fixed inset-0 z-[960] flex items-center justify-center"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[3px]"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-5xl mx-4 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center">
              <Bot size={16} className="text-indigo-500" />
            </div>
            <div>
              <h2
                className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 leading-snug"
                style={{ letterSpacing: "-0.01em" }}
              >
                Configure AI Tool
                {(label || sectionId) && (
                  <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
                    — {label ?? `Section ${sectionId}`}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                Set up the agent configuration for this section.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 cursor-pointer"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Divider */}
        <div className="h-px bg-slate-100 dark:bg-slate-800 mx-6" />

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5 flex-1">

          {/* Tool Name + Model */}
          <div className="flex gap-4">
            <div className="flex-1">
              <FieldLabel htmlFor="tool-name">Tool Name</FieldLabel>
              <input
                id="tool-name"
                type="text"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                disabled={isDisabled}
                placeholder="e.g. SRS Section Writer"
                className={inputCls}
                style={{ fontFamily: "'Inter', sans-serif" }}
              />
            </div>
            <div className="w-48 flex-shrink-0">
              <FieldLabel htmlFor="tool-model">Model</FieldLabel>
              <div className="relative">
                <select
                  id="tool-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={isDisabled}
                  className={`${inputCls} appearance-none pr-8`}
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
              </div>
            </div>
          </div>

          {/* Tool Description */}
          <div>
            <FieldLabel htmlFor="tool-description">Tool Description</FieldLabel>
            <textarea
              id="tool-description"
              value={toolDescription}
              onChange={(e) => setToolDescription(e.target.value)}
              disabled={isDisabled}
              placeholder="Briefly describe what this tool does…"
              rows={3}
              className={`${inputCls} resize-none leading-relaxed`}
              style={{ fontFamily: "'Inter', sans-serif" }}
            />
          </div>

          {/* Default Prompt */}
          <div>
            <FieldLabel htmlFor="default-prompt">Default Prompt</FieldLabel>
            <textarea
              id="default-prompt"
              value={defaultPrompt}
              onChange={(e) => setDefaultPrompt(e.target.value)}
              disabled={isDisabled}
              placeholder="The default prompt sent to the model…"
              rows={3}
              className={`${inputCls} resize-none leading-relaxed`}
              style={{ fontFamily: "'Inter', sans-serif" }}
            />
          </div>

          {/* Instruction — dark code editor */}
          <div>
            <FieldLabel htmlFor="tool-instruction">Instruction</FieldLabel>
            <InstructionEditor
              value={instruction}
              onChange={setInstruction}
              disabled={isDisabled}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/80 rounded-b-2xl flex-shrink-0">
          {isFetching && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" />
              Loading…
            </span>
          )}
          <span className="mr-auto text-[10.5px] text-slate-300 dark:text-slate-700 select-none hidden sm:block">
            Ctrl+Enter to save
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isDisabled}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg text-white bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 focus:ring-offset-1 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            {isSaving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export default ToolModal;
