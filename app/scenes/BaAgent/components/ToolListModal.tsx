import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import useStores from "~/hooks/useStores";
import { deleteAgentTool, listAgentTools } from "../api";
import type { AgentTool } from "../type";
import ToolModal from "./ToolModal";

interface ToolListModalProps {
  onClose?: () => void;
}

function ToolListModal({ onClose: _onClose }: ToolListModalProps) {
  const { auth } = useStores();
  const workspaceId = auth.currentTeamId ?? "";

  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [toolModalOpen, setToolModalOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTools = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    listAgentTools(workspaceId)
      .then(setTools)
      .catch(() => toast.error("Failed to load tools."))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const handleAdd = () => {
    setActiveSectionId(crypto.randomUUID());
    setActiveLabel(undefined);
    setToolModalOpen(true);
  };

  const handleEdit = (tool: AgentTool) => {
    setActiveSectionId(tool.sectionId);
    setActiveLabel(tool.toolName);
    setToolModalOpen(true);
  };

  const handleDelete = async (tool: AgentTool) => {
    if (!window.confirm(`Delete tool "${tool.toolName}"?`)) return;
    setDeletingId(tool.id);
    try {
      await deleteAgentTool(tool.id);
      toast.success("Tool deleted.");
      fetchTools();
    } catch {
      toast.error("Failed to delete tool.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-5 min-w-0">

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-slate-400 dark:text-slate-500 leading-snug">
            AI tools available to the BA Agent for this workspace.
          </p>
          <button
            type="button"
            onClick={handleAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-lg
              border border-slate-200 dark:border-slate-700
              bg-white dark:bg-slate-800
              text-slate-600 dark:text-slate-300
              hover:bg-slate-50 dark:hover:bg-slate-700
              hover:border-slate-300 dark:hover:border-slate-600
              hover:text-slate-800 dark:hover:text-slate-100
              transition-all duration-150 cursor-pointer flex-shrink-0 shadow-sm"
          >
            <Plus size={13} strokeWidth={2.5} />
            New tool
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-14 text-slate-300 dark:text-slate-600">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && tools.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Wrench size={18} className="text-slate-400 dark:text-slate-500" />
            </div>
            <div>
              <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
                No tools configured yet
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                Add your first AI tool to get started.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAdd}
              className="mt-1 flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg
                bg-blue-500 hover:bg-blue-600 text-white
                transition-colors duration-150 cursor-pointer shadow-sm"
            >
              <Plus size={12} strokeWidth={2.5} />
              Create first tool
            </button>
          </div>
        )}

        {/* Table */}
        {!loading && tools.length > 0 && (
          <div className="rounded-xl border border-slate-100 dark:border-slate-800 overflow-hidden shadow-sm">
            <table className="w-full table-fixed">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 w-1/3">
                    Name
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 w-32">
                    Model
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 hidden sm:table-cell">
                    Description
                  </th>
                  <th className="w-24" aria-hidden />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                {tools.map((tool) => (
                  <tr
                    key={tool.id}
                    className="group bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors duration-100"
                  >
                    {/* Name */}
                    <td className="px-4 py-3.5 overflow-hidden">
                      <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 tracking-tight block truncate">
                        {tool.toolName}
                      </span>
                    </td>

                    {/* Model badge */}
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium
                        bg-indigo-50 dark:bg-indigo-950/40
                        text-indigo-600 dark:text-indigo-400
                        border border-indigo-100 dark:border-indigo-900/60
                        whitespace-nowrap">
                        {tool.model}
                      </span>
                    </td>

                    {/* Description */}
                    <td className="px-4 py-3.5 hidden sm:table-cell max-w-[220px]">
                      {tool.toolDescription ? (
                        <span className="text-[13px] text-slate-400 dark:text-slate-500 truncate block">
                          {tool.toolDescription}
                        </span>
                      ) : (
                        <span className="text-[13px] text-slate-300 dark:text-slate-600 italic">
                          No description
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-3.5 w-24">
                      <div className="flex items-center gap-0.5 justify-end
                        opacity-0 group-hover:opacity-100
                        transition-opacity duration-150">
                        <button
                          type="button"
                          onClick={() => handleEdit(tool)}
                          title="Edit tool"
                          className="h-7 w-7 flex items-center justify-center rounded-md
                            text-slate-400 hover:text-blue-500
                            hover:bg-blue-50 dark:hover:bg-blue-950/30
                            transition-colors duration-150 cursor-pointer"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(tool)}
                          disabled={deletingId === tool.id}
                          title="Delete tool"
                          className="h-7 w-7 flex items-center justify-center rounded-md
                            text-slate-400 hover:text-red-500
                            hover:bg-red-50 dark:hover:bg-red-950/30
                            transition-colors duration-150 cursor-pointer
                            disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {deletingId === tool.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer count */}
            <div className="px-4 py-2 bg-slate-50/70 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">
              <p className="text-[11px] text-slate-400 dark:text-slate-600">
                {tools.length} tool{tools.length !== 1 ? "s" : ""} configured
              </p>
            </div>
          </div>
        )}
      </div>

      <ToolModal
        open={toolModalOpen}
        sectionId={activeSectionId}
        label={activeLabel}
        onSaveSuccess={fetchTools}
        onClose={() => setToolModalOpen(false)}
      />
    </>
  );
}

export default ToolListModal;
