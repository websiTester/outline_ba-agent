import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
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

function ToolModal({ open, onClose, sectionId, label, onSaveSuccess }: ToolModalProps) {
  const { auth } = useStores();

  const [toolName, setToolName] = useState("");
  const [model, setModel] = useState("gemini-2.5-flash");
  const [toolDescription, setToolDescription] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || !sectionId || !auth.currentTeamId) return;

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
      .catch(() => {
        toast.error("Failed to load tool configuration.");
      })
      .finally(() => setIsFetching(false));
  }, [open, sectionId, auth.currentTeamId]);

  const handleSave = async () => {
    if (!sectionId || !auth.currentTeamId) return;

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

  if (!open) return null;

  const isDisabled = isFetching || isSaving;

  return (
    <div className="fixed inset-0 z-[960] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-5xl mx-4 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
              Configure AI Tool
              {label && (
                <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
                  — {label}
                </span>
              )}
              {!label && sectionId && (
                <span className="ml-2 text-xs font-normal text-slate-400 dark:text-slate-500">
                  — Section {sectionId}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Set up the agent configuration for this section.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 cursor-pointer"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Divider */}
        <div className="h-px bg-slate-100 dark:bg-slate-800 mx-6" />

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5 flex-1">

          {/* Tool Name + Model */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label
                htmlFor="tool-name"
                className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5"
              >
                Tool Name
              </label>
              <input
                id="tool-name"
                type="text"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                disabled={isDisabled}
                placeholder="e.g. SRS Section Writer"
                className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 px-3 py-2 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div className="w-44 flex-shrink-0">
              <label
                htmlFor="tool-model"
                className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5"
              >
                Model
              </label>
              <select
                id="tool-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={isDisabled}
                className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-3 py-2 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all duration-150 appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tool Description */}
          <div>
            <label
              htmlFor="tool-description"
              className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5"
            >
              Tool Description
            </label>
            <textarea
              id="tool-description"
              value={toolDescription}
              onChange={(e) => setToolDescription(e.target.value)}
              disabled={isDisabled}
              placeholder="Briefly describe what this tool does…"
              rows={3}
              className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 px-3 py-2 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all duration-150 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Default Prompt */}
          <div>
            <label
              htmlFor="default-prompt"
              className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5"
            >
              Default Prompt
            </label>
            <textarea
              id="default-prompt"
              value={defaultPrompt}
              onChange={(e) => setDefaultPrompt(e.target.value)}
              disabled={isDisabled}
              placeholder="The default prompt sent to the model…"
              rows={3}
              className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 px-3 py-2 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all duration-150 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Instruction */}
          <div>
            <label
              htmlFor="tool-instruction"
              className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1.5"
            >
              Instruction
            </label>
            <textarea
              id="tool-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={isDisabled}
              placeholder="System-level instructions for the agent…"
              rows={20}
              className="w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 px-3 py-2 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all duration-150 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 rounded-b-xl flex-shrink-0">
          {isFetching && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" />
              Loading…
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isDisabled}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg text-white bg-blue-500 hover:bg-blue-600 active:bg-blue-700 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-400/40 focus:ring-offset-1 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
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
