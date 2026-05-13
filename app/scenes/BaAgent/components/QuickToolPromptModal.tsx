'use client';

import { useEffect, useState } from 'react';
import { X, Save, Loader2, CheckCircle2, Pencil, Settings, BrainCircuit } from 'lucide-react';
import { AgentTool } from '../type';


const DELIMITER = '<#>';
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
const updateApiUrl = `${baseUrl}/tools_management/update_tool`;

interface QuickToolPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTool: AgentTool | null;
  subsectionLabel: string;
  onAdvanced: (currentToolPrompt: string) => void;
  onSaved: () => void;
  onQuickAsk: (prompt: string) => void;
}

function extractUserContent(toolPrompt: string): string {
  const parts = toolPrompt.split(DELIMITER);
  if (parts.length < 3) return toolPrompt;
  return parts[1].trim();
}

function replaceUserContent(toolPrompt: string, newContent: string): string {
  const parts = toolPrompt.split(DELIMITER);
  if (parts.length < 3) return toolPrompt;
  return `${parts[0]}${DELIMITER}\n${newContent}\n${DELIMITER}${parts[2]}`;
}

export default function QuickToolPromptModal({
  isOpen, onClose, selectedTool, subsectionLabel, onAdvanced, onSaved, onQuickAsk
}: QuickToolPromptModalProps) {
  const [userContent, setUserContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const isExistingTool = !!selectedTool?.id;

  useEffect(() => {
    if (!isOpen || !selectedTool) return;
    setUserContent(extractUserContent(selectedTool.defaultPrompt || ''));
    setSubmitStatus('idle');
  }, [isOpen, selectedTool]);

  const handleSave = async () => {
    if (!isExistingTool) return;
    setIsSubmitting(true);
    setSubmitStatus('idle');
    try {
      const updatedToolPrompt = replaceUserContent(selectedTool!.defaultPrompt || '', userContent);
      const result = await fetch(`${updateApiUrl}/${selectedTool!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selectedTool, toolPrompt: updatedToolPrompt }),
      });
      if (!result.ok) throw new Error('Failed to save');

      setSubmitStatus('success');
      setTimeout(() => onSaved(), 600);
    } catch {
      setSubmitStatus('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-orange-100 bg-orange-50/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-orange-100/50 rounded-lg">
              <Pencil className="w-4 h-4 text-orange-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Quick Prompt</h2>
              <p className="text-xs text-gray-500">{subsectionLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {!isExistingTool && (
            <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <p className="text-xs text-amber-700">
                No tool configured for this subsection. Click <strong>Advanced</strong> to create one.
              </p>
            </div>
          )}
          <label className="text-xs font-medium text-gray-600 mb-1.5 block">Tool Prompt</label>
          <textarea
            value={userContent}
            onChange={(e) => setUserContent(e.target.value)}
            disabled={!isExistingTool}
            rows={6}
            placeholder={isExistingTool ? "Enter the prompt text to inject into agent messages..." : "Create a tool first via Advanced..."}
            className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-100 focus:border-orange-300 transition-all placeholder:text-gray-400 resize-none disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
          />
          {submitStatus === 'error' && (
            <p className="text-xs text-red-600 mt-1.5">Failed to save. Please try again.</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <button
            onClick={() => onAdvanced(replaceUserContent(selectedTool?.defaultPrompt || '', userContent))}
            className="px-3 py-2 text-xs font-medium text-gray-600 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors border border-gray-200 flex items-center gap-1.5"
          >
            <Settings size={14} />
            Advanced
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onQuickAsk(replaceUserContent(selectedTool?.defaultPrompt || '', userContent))}
              disabled={!isExistingTool || isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-sky-700 bg-sky-50 border border-sky-100 rounded-lg hover:bg-sky-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <BrainCircuit size={15} className="text-sky-600" />
              <span>Quick Ask</span>
            </button>
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-600 bg-white hover:bg-gray-50 rounded-lg transition-colors border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!isExistingTool || isSubmitting || submitStatus === 'success'}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${submitStatus === 'success'
                ? 'bg-green-500 hover:bg-green-600'
                : 'bg-orange-400 hover:bg-orange-500'
                }`}
            >
              {isSubmitting ? (
                <><Loader2 size={14} className="animate-spin" /> Saving...</>
              ) : submitStatus === 'success' ? (
                <><CheckCircle2 size={14} /> Saved!</>
              ) : (
                <><Save size={14} /> Save</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
