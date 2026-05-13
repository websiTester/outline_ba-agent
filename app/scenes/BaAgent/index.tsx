import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import useStores from "~/hooks/useStores";
import CenteredContent from "~/components/CenteredContent";
import PageTitle from "~/components/PageTitle";
import { ALL_LEAF_IDS, getSectionById } from "./constants/srsSections";
import type { AgentTool } from "./type";
import { createSrsDocuments, generateSRS, listAgentTools, pollJob } from "./api";
import CollectionSelector from "./components/CollectionSelector";
import FileUploadSection from "./components/FileUploadSection";
import SrsChecklist from "./components/SrsChecklist";
import ToolModal from "./components/ToolModal";
import SrsPromptModal from "./components/SrsPromptModal";

function BaAgent() {
  const { auth } = useStores();
  const workspaceId = auth.currentTeamId ?? "";

  const [file, setFile] = useState<File | null>(null);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [toolModalOpen, setToolModalOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const [srsPromptModalOpen, setSrsPromptModalOpen] = useState(false);
  const [srsPromptSectionId, setSrsPromptSectionId] = useState<string | null>(null);
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({});

  const [agentTools, setAgentTools] = useState<AgentTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [toolsError, setToolsError] = useState(false);

  const [collectionId, setCollectionId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const refreshAgentTools = () => {
    if (!workspaceId) return;
    setLoadingTools(true);
    setToolsError(false);
    listAgentTools(workspaceId)
      .then((tools) => {
        setAgentTools(tools);
        setPromptOverrides({});
      })
      .catch(() => setToolsError(true))
      .finally(() => setLoadingTools(false));
  };

  useEffect(() => {
    refreshAgentTools();
  }, [workspaceId]);

  const canSubmit =
    file !== null &&
    selectedSections.length > 0 &&
    collectionId !== "" &&
    !isGenerating;

  const handleSaveOverride = (sectionId: string, fullPrompt: string) => {
    setPromptOverrides((prev) => ({ ...prev, [sectionId]: fullPrompt }));
  };

  const handleOpenAdvancedSetting = () => {
    setActiveSectionId(srsPromptSectionId);
    setToolModalOpen(true);
  };

  const handleGenerateSRS = async () => {
    if (!file || !workspaceId || !collectionId) return;

    const orderedIds = ALL_LEAF_IDS.filter((id) => selectedSections.includes(id));
    const prompt = orderedIds
      .map((id) => promptOverrides[id] ?? agentTools.find((t) => t.sectionId === id)?.defaultPrompt ?? "")
      .filter(Boolean)
      .join("\n\n");

    setIsGenerating(true);
    try {
      const { job_id } = await generateSRS(file, prompt, workspaceId, orderedIds);

      toast.info("SRS generation started. Processing in background…");

      const result = await pollJob(job_id);

      if (result.status === "completed" && result.results) {
        await createSrsDocuments(result.results, collectionId);
        toast.success("SRS generated. Check your selected Outline collection.");
      } else {
        toast.error(result.error ?? "SRS generation failed. Please try again.");
      }
    } catch {
      toast.error("Failed to generate SRS. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <CenteredContent>
      <PageTitle title="BA Agent" />
      <div className="py-10 px-8 max-w-5xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            BA Agent
          </h1>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            Upload a requirements document and select SRS sections to generate.
          </p>
        </div>

        <div className="flex gap-5 items-start">
          {/* Left column — File Upload + API settings (40%) */}
          <div className="w-2/5 flex-shrink-0 flex flex-col gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
                Requirements Document
              </p>
              <FileUploadSection file={file} onChange={setFile} />
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900 p-5">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Target Collection
                </label>
                <CollectionSelector
                  value={collectionId}
                  onChange={setCollectionId}
                />
              </div>
            </div>
          </div>

          {/* Right column — SRS Checklist (60%) */}
          <div className="flex-1 min-w-0">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm bg-white dark:bg-slate-900 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
                SRS Sections
              </p>
              <SrsChecklist
                selectedSections={selectedSections}
                onChange={setSelectedSections}
                onOpenToolModal={(sectionId) => {
                  setSrsPromptSectionId(sectionId);
                  setSrsPromptModalOpen(true);
                }}
                agentTools={agentTools}
                loading={loadingTools}
                error={toolsError}
              />
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <button
                  disabled={!canSubmit}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-35 disabled:cursor-not-allowed transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1"
                  onClick={handleGenerateSRS}
                >
                  {isGenerating && <Loader2 size={14} className="animate-spin" />}
                  {isGenerating ? "Processing…" : "Generate SRS"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ToolModal
        open={toolModalOpen}
        sectionId={activeSectionId}
        label={activeSectionId ? getSectionById(activeSectionId)?.label : undefined}
        onClose={() => {
          setToolModalOpen(false);
          setActiveSectionId(null);
        }}
        onSaveSuccess={refreshAgentTools}
      />

      <SrsPromptModal
        isOpen={srsPromptModalOpen}
        onClose={() => {
          setSrsPromptModalOpen(false);
          setSrsPromptSectionId(null);
        }}
        sectionId={srsPromptSectionId ?? ""}
        sectionLabel={srsPromptSectionId ? (getSectionById(srsPromptSectionId)?.label ?? "") : ""}
        agentTool={srsPromptSectionId ? (agentTools.find((t) => t.sectionId === srsPromptSectionId) ?? null) : null}
        currentOverride={srsPromptSectionId ? (promptOverrides[srsPromptSectionId] ?? null) : null}
        onSaveOverride={handleSaveOverride}
        onOpenAdvancedSetting={handleOpenAdvancedSetting}
      />
    </CenteredContent>
  );
}

export default observer(BaAgent);
