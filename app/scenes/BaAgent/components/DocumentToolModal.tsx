import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AlertCircle, Loader2, SendHorizonal } from "lucide-react";
import Modal from "~/components/Modal";
import type Document from "~/models/Document";
import { ProsemirrorHelper } from "~/models/helpers/ProsemirrorHelper";
import {
  createOutlineDocument,
  getAgentToolByToolName,
  pollJob,
  runDocumentTool,
} from "../api";
import type { AgentTool } from "../type";
import {
  extractUserContent,
  replaceUserContent,
  hasDelimiter,
} from "../utils/promptUtils";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  toolName: string;
  title: string;
  document: Document;
};

export default function DocumentToolModal({ isOpen, onClose, toolName, title, document }: Props) {
  const { t } = useTranslation();
  const [agentTool, setAgentTool] = useState<AgentTool | null>(null);
  const [fullPrompt, setFullPrompt] = useState("");
  const [userContent, setUserContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) { return; }
    setAgentTool(null);
    setFullPrompt("");
    setUserContent("");
    setError(null);
    setLoading(true);

    getAgentToolByToolName(toolName)
      .then((tool) => {
        setAgentTool(tool);
        setFullPrompt(tool.defaultPrompt);
        setUserContent(extractUserContent(tool.defaultPrompt));
      })
      .catch(() => setError(t("Failed to load tool configuration. Please try again.")))
      .finally(() => setLoading(false));
  }, [isOpen, toolName]);

  const handleSend = async () => {
    if (!agentTool) { return; }
    const content = ProsemirrorHelper.toMarkdown(document) ?? "";

    // Q4: empty → use defaultPrompt as-is; else reconstruct full prompt
    const promptToSend = userContent.trim() === ""
      ? agentTool.defaultPrompt
      : hasDelimiter(fullPrompt)
        ? replaceUserContent(fullPrompt, userContent)
        : userContent;

    onClose();

    const toastId = toast.loading(t("Running {{tool}}…", { tool: agentTool.toolName }));

    try {
      const { job_id } = await runDocumentTool({
        agentTool,
        prompt: promptToSend,
        document: { id: document.id, title: document.title, content },
      });

      const job = await pollJob(job_id);

      if (job.status === "failed") {
        toast.error(t("Failed to run {{tool}}", { tool: agentTool.toolName }), { id: toastId });
        return;
      }

      const result = job.results?.[0];
      if (result && document.collectionId) {
        await createOutlineDocument(document.collectionId, agentTool.toolName, result.content, {
          parentDocumentId: document.id,
        });
      }

      toast.success(t("{{tool}} completed", { tool: agentTool.toolName }), { id: toastId });
    } catch {
      toast.error(t("Failed to run {{tool}}", { tool: agentTool.toolName }), { id: toastId });
    }
  };

  return (
    <Modal isOpen={isOpen} onRequestClose={onClose} title={title} width="560px">
      <div className="flex flex-col gap-4">

        {/* Content area */}
        {loading ? (
          <div className="flex items-center justify-center gap-2.5 py-10 text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">{t("Loading…")}</span>
          </div>
        ) : error ? (
          <div className="flex items-start gap-3 rounded-r-lg border-l-4 border-red-400 bg-red-50 p-3.5">
            <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-red-400" />
            <p className="text-sm leading-snug text-red-600">{error}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              {t("Prompt")}
            </label>
            <textarea
              value={userContent}
              onChange={(e) => setUserContent(e.target.value)}
              rows={8}
              placeholder={t("Enter prompt…")}
              className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-300 outline-none transition-all duration-150 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-400/20"
            />
            <p className="text-[11px] text-slate-400">
              {t("Customize the prompt before sending to the agent.")}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700"
          >
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || !!error}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <SendHorizonal size={14} />
            {t("Send")}
          </button>
        </div>

      </div>
    </Modal>
  );
}
