import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import Modal from "~/components/Modal";
import type { AgentTool } from "../type";
import {
  extractUserContent,
  replaceUserContent,
  hasDelimiter,
} from "../utils/promptUtils";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sectionId: string;
  sectionLabel: string;
  agentTool: AgentTool | null;
  currentOverride: string | null;
  onSaveOverride: (sectionId: string, fullPrompt: string) => void;
  onOpenAdvancedSetting: () => void;
};

export default function SrsPromptModal({
  isOpen,
  onClose,
  sectionId,
  sectionLabel,
  agentTool,
  currentOverride,
  onSaveOverride,
  onOpenAdvancedSetting,
}: Props) {
  const [userContent, setUserContent] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const base = currentOverride ?? agentTool?.defaultPrompt ?? "";
    setUserContent(extractUserContent(base));
  }, [isOpen, sectionId]);

  const handleApply = () => {
    if (!agentTool) return;
    const promptToSave =
      userContent.trim() === ""
        ? agentTool.defaultPrompt
        : hasDelimiter(agentTool.defaultPrompt)
          ? replaceUserContent(agentTool.defaultPrompt, userContent)
          : userContent;
    onSaveOverride(sectionId, promptToSave);
    onClose();
  };

  const handleAdvancedSetting = () => {
    onClose();
    onOpenAdvancedSetting();
  };

  const title = `Prompt — ${sectionId}. ${sectionLabel}`;

  return (
    <Modal isOpen={isOpen} onRequestClose={onClose} title={title} width="560px">
      <div className="flex flex-col gap-4">

        {/* Content area */}
        {agentTool === null ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Chưa có AgentTool cho section này
            </p>
            <p className="text-xs text-slate-300 dark:text-slate-600">
              Nhấn Advanced Setting để cấu hình AgentTool.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Prompt
            </label>
            <textarea
              value={userContent}
              onChange={(e) => setUserContent(e.target.value)}
              rows={8}
              placeholder="Enter prompt…"
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-300 outline-none transition-all duration-150 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-600 dark:focus:bg-slate-800"
            />
            <p className="text-[11px] text-slate-400">
              Chỉnh sửa prompt cho section này trước khi Generate SRS.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={handleAdvancedSetting}
            className="mr-auto flex cursor-pointer items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <Settings2 size={14} />
            Advanced Setting
          </button>

          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            Cancel
          </button>

          {agentTool !== null && (
            <button
              type="button"
              onClick={handleApply}
              className="cursor-pointer rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply
            </button>
          )}
        </div>

      </div>
    </Modal>
  );
}
