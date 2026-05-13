import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import useStores from "~/hooks/useStores";
import {
  activateGeminiKey,
  addGeminiKey,
  deleteGeminiKey,
  listGeminiKeys,
  type GeminiKey,
} from "../api";

function GeminiKeyModal() {
  const { auth } = useStores();
  const workspaceId = auth.currentTeamId ?? "";

  const [keys, setKeys] = useState<GeminiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchKeys = useCallback(() => {
    if (!workspaceId) { return; }
    setLoading(true);
    listGeminiKeys(workspaceId)
      .then(setKeys)
      .catch(() => toast.error("Failed to load API keys."))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleAdd = async () => {
    const trimmed = newKey.trim();
    if (!trimmed) { return; }
    setAdding(true);
    try {
      await addGeminiKey(workspaceId, trimmed);
      setNewKey("");
      toast.success("API key added.");
      fetchKeys();
    } catch {
      toast.error("Failed to add API key.");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (key: GeminiKey) => {
    if (!window.confirm("Delete this API key?")) { return; }
    setDeletingId(key.id);
    try {
      await deleteGeminiKey(key.id);
      toast.success("API key deleted.");
      fetchKeys();
    } catch {
      toast.error("Failed to delete API key.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleActivate = async (key: GeminiKey) => {
    if (key.isActive) { return; }
    setActivatingId(key.id);
    try {
      await activateGeminiKey(key.id);
      fetchKeys();
    } catch {
      toast.error("Failed to activate API key.");
    } finally {
      setActivatingId(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { void handleAdd(); }
  };

  return (
    <div className="flex flex-col gap-5 min-w-0">
      {/* Description */}
      <p className="text-[13px] text-slate-400 dark:text-slate-500 leading-snug">
        Gemini API keys for this workspace. The active key is used for all AI
        requests. On quota error the system auto-rotates to the next key.
      </p>

      {/* Add key input */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="password"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste new Gemini API key…"
          className="flex-1 min-w-0 px-3 py-2 text-[13px] rounded-lg
            border border-slate-200 dark:border-slate-700
            bg-white dark:bg-slate-800
            text-slate-700 dark:text-slate-200
            placeholder-slate-300 dark:placeholder-slate-600
            focus:outline-none focus:ring-2 focus:ring-blue-400/40
            focus:border-blue-400 dark:focus:border-blue-500
            transition"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !newKey.trim()}
          className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg
            border border-slate-200 dark:border-slate-700
            bg-white dark:bg-slate-800
            text-slate-600 dark:text-slate-300
            hover:bg-slate-50 dark:hover:bg-slate-700
            hover:border-slate-300 dark:hover:border-slate-600
            hover:text-slate-800 dark:hover:text-slate-100
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-all duration-150 cursor-pointer flex-shrink-0 shadow-sm"
        >
          {adding ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Plus size={13} strokeWidth={2.5} />
          )}
          Add
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-14 text-slate-300 dark:text-slate-600">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && keys.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <KeyRound size={18} className="text-slate-400 dark:text-slate-500" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-slate-600 dark:text-slate-300">
              No API keys yet
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              Add a Gemini API key above to get started.
            </p>
          </div>
        </div>
      )}

      {/* Key list */}
      {!loading && keys.length > 0 && (
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 overflow-hidden shadow-sm">
          <ul className="divide-y divide-slate-50 dark:divide-slate-800">
            {keys.map((key) => (
              <li
                key={key.id}
                className="group flex items-center gap-3 px-4 py-3
                  bg-white dark:bg-slate-900
                  hover:bg-slate-50/80 dark:hover:bg-slate-800/40
                  transition-colors duration-100"
              >
                {/* Radio active selector */}
                <button
                  type="button"
                  onClick={() => void handleActivate(key)}
                  disabled={key.isActive || activatingId === key.id}
                  title={key.isActive ? "Active key" : "Set as active"}
                  className="flex-shrink-0 w-4 h-4 rounded-full border-2
                    flex items-center justify-center
                    transition-colors duration-150 cursor-pointer
                    disabled:cursor-default
                    focus:outline-none"
                  style={{
                    borderColor: key.isActive ? "#3b82f6" : "#cbd5e1",
                    backgroundColor: "transparent",
                  }}
                >
                  {activatingId === key.id ? (
                    <Loader2 size={8} className="animate-spin text-blue-400" />
                  ) : key.isActive ? (
                    <span
                      className="w-2 h-2 rounded-full block"
                      style={{ backgroundColor: "#3b82f6" }}
                    />
                  ) : null}
                </button>

                {/* Masked key value */}
                <span className="flex-1 min-w-0 font-mono text-[13px] text-slate-600 dark:text-slate-300 truncate">
                  {key.keyValue}
                </span>

                {/* Active badge */}
                {key.isActive && (
                  <span className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium
                    bg-blue-50 dark:bg-blue-950/40
                    text-blue-600 dark:text-blue-400
                    border border-blue-100 dark:border-blue-900/60">
                    active
                  </span>
                )}

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => void handleDelete(key)}
                  disabled={deletingId === key.id}
                  title="Delete key"
                  className="flex-shrink-0 h-7 w-7 flex items-center justify-center rounded-md
                    text-slate-300 dark:text-slate-600
                    hover:text-red-500 dark:hover:text-red-400
                    hover:bg-red-50 dark:hover:bg-red-950/30
                    opacity-0 group-hover:opacity-100
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-all duration-150 cursor-pointer"
                >
                  {deletingId === key.id ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                </button>
              </li>
            ))}
          </ul>

          {/* Footer */}
          <div className="px-4 py-2 bg-slate-50/70 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800">
            <p className="text-[11px] text-slate-400 dark:text-slate-600">
              {keys.length} key{keys.length !== 1 ? "s" : ""} configured
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default GeminiKeyModal;
