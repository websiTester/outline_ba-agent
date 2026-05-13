import { useRef, useState } from "react";
import {
  SRS_SECTIONS,
  ALL_LEAF_IDS,
  getSectionLeafIds,
  type SrsSection,
} from "../constants/srsSections";
import { Pencil } from "lucide-react";
import type { AgentTool } from "../type";

const DISABLED_TOOLTIP = "Vui lòng thêm AgentTool cho section này trước khi chọn";

interface Props {
  selectedSections: string[];
  onChange: (selectedSections: string[]) => void;
  onOpenToolModal: (sectionId: string) => void;
  agentTools: AgentTool[];
  loading: boolean;
  error: boolean;
}

type CheckState = "checked" | "unchecked" | "indeterminate";

interface PromptIconButtonProps {
  openToolModal: () => void;
}

function getParentState(leafIds: string[], selected: string[]): CheckState {
  const count = leafIds.filter((id) => selected.includes(id)).length;
  if (count === 0) return "unchecked";
  if (count === leafIds.length) return "checked";
  return "indeterminate";
}

function getGlobalState(selected: string[]): CheckState {
  if (selected.length === 0) return "unchecked";
  if (selected.length === ALL_LEAF_IDS.length) return "checked";
  return "indeterminate";
}

function IndeterminateCheckbox({
  state,
  onChange,
  label,
}: {
  state: CheckState;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  if (ref.current) {
    ref.current.indeterminate = state === "indeterminate";
    ref.current.checked = state === "checked";
  }

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === "checked"}
      onChange={onChange}
      className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 accent-blue-500 cursor-pointer flex-shrink-0"
    />
  );
}

function SectionRow({
  section,
  selected,
  expanded,
  disabledIds,
  onToggleExpand,
  onToggleSection,
  onToggleChild,
  onOpenToolModal,
}: {
  section: SrsSection;
  selected: string[];
  expanded: boolean;
  disabledIds: string[];
  onToggleExpand: () => void;
  onToggleSection: (section: SrsSection) => void;
  onToggleChild: (id: string) => void;
  onOpenToolModal: (sectionId: string) => void;
}) {
  const leafIds = getSectionLeafIds(section);
  const isLeaf = !section.children;
  const parentState = getParentState(leafIds, selected);
  const isLeafDisabled = isLeaf && disabledIds.includes(section.id);

  return (
    <div>
      <div
        className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors duration-100 group"
        title={isLeafDisabled ? DISABLED_TOOLTIP : undefined}
      >
        {isLeaf ? (
          <input
            type="checkbox"
            id={`srs-${section.id}`}
            checked={selected.includes(section.id)}
            onChange={() => !isLeafDisabled && onToggleChild(section.id)}
            disabled={isLeafDisabled}
            className={`w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 flex-shrink-0 ${
              isLeafDisabled
                ? "opacity-40 cursor-not-allowed"
                : "accent-blue-500 cursor-pointer"
            }`}
          />
        ) : (
          <IndeterminateCheckbox
            state={parentState}
            onChange={() => onToggleSection(section)}
            label={section.label}
          />
        )}

        {!isLeaf ? (
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-center gap-1.5 flex-1 text-left cursor-pointer"
          >
            <svg
              className={`w-3 h-3 text-slate-300 dark:text-slate-600 flex-shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""
                }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm text-slate-700 dark:text-slate-300 font-medium">
              {section.id}. {section.label}
            </span>
          </button>
        ) : (
          <>
            <label
              htmlFor={`srs-${section.id}`}
              className={`flex-1 text-sm font-medium pl-[18px] select-none ${
                isLeafDisabled
                  ? "text-slate-400 dark:text-slate-500 cursor-not-allowed"
                  : "text-slate-700 dark:text-slate-300 cursor-pointer"
              }`}
            >
              {section.id}. {section.label}
            </label>
            <PromptIconButton openToolModal={() => onOpenToolModal(section.id)} />
          </>
        )}
      </div>

      {!isLeaf && expanded && (
        <div className="ml-[26px] border-l border-slate-100 dark:border-slate-800 pl-3 mb-0.5">
          {section.children!.map((child) => {
            const isDisabled = disabledIds.includes(child.id);
            return (
              <div
                key={child.id}
                className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors duration-100"
                title={isDisabled ? DISABLED_TOOLTIP : undefined}
              >
                <input
                  type="checkbox"
                  id={`srs-${child.id}`}
                  checked={selected.includes(child.id)}
                  onChange={() => !isDisabled && onToggleChild(child.id)}
                  disabled={isDisabled}
                  className={`w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 flex-shrink-0 ${
                    isDisabled
                      ? "opacity-40 cursor-not-allowed"
                      : "accent-blue-500 cursor-pointer"
                  }`}
                />
                <label
                  htmlFor={`srs-${child.id}`}
                  className={`flex-1 text-sm select-none ${
                    isDisabled
                      ? "text-slate-400 dark:text-slate-500 cursor-not-allowed"
                      : "text-slate-500 dark:text-slate-400 cursor-pointer"
                  }`}
                >
                  {child.id}&nbsp;&nbsp;{child.label}
                </label>
                <PromptIconButton openToolModal={() => onOpenToolModal(child.id)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PromptIconButton({ openToolModal }: PromptIconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openToolModal();
      }}
      className="h-6 w-6 rounded-md border border-gray-200 bg-white text-gray-400 hover:text-orange-500 hover:border-orange-200 hover:bg-orange-50 transition-colors flex items-center justify-center flex-shrink-0"
      aria-label="Configure prompt"
      title="Configure prompt"
    >
      <Pencil size={12} />
    </button>
  );
}

function SrsChecklist({ selectedSections, onChange, onOpenToolModal, agentTools, loading, error }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const disabledIds = error
    ? ALL_LEAF_IDS
    : ALL_LEAF_IDS.filter((id) => !agentTools.some((t) => t.sectionId === id));

  const hasDisabled = disabledIds.length > 0;

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleSection(section: SrsSection) {
    const leafIds = getSectionLeafIds(section);
    const enabledLeafIds = leafIds.filter((id) => !disabledIds.includes(id));
    const state = getParentState(leafIds, selectedSections);
    if (state === "checked") {
      onChange(selectedSections.filter((id) => !enabledLeafIds.includes(id)));
    } else {
      onChange(Array.from(new Set([...selectedSections, ...enabledLeafIds])));
    }
  }

  function toggleChild(id: string) {
    if (selectedSections.includes(id)) {
      onChange(selectedSections.filter((s) => s !== id));
    } else {
      onChange([...selectedSections, id]);
    }
  }

  function toggleSelectAll() {
    const state = getGlobalState(selectedSections);
    onChange(state === "checked" ? [] : [...ALL_LEAF_IDS]);
  }

  const globalState = getGlobalState(selectedSections);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <svg
          className="w-6 h-6 text-blue-400 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          Đang tải cấu hình AgentTool...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <span className="text-xs text-red-500 dark:text-red-400 text-center">
          Không thể tải cấu hình AgentTool. Tất cả sections bị vô hiệu hóa.
        </span>
      </div>
    );
  }

  return (
    <div>
      {/* Select All row — ẩn nếu có bất kỳ item nào bị disabled */}
      {!hasDisabled && (
        <div className="flex items-center gap-2.5 py-1.5 px-2 mb-1 border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <IndeterminateCheckbox
            state={globalState}
            onChange={toggleSelectAll}
            label="Select all sections"
          />
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider select-none">
            Select all
          </span>
          {selectedSections.length > 0 && (
            <span className="ml-auto text-xs text-slate-300 dark:text-slate-600 tabular-nums">
              {selectedSections.length} / {ALL_LEAF_IDS.length}
            </span>
          )}
        </div>
      )}

      {/* Sections */}
      <div className="space-y-0">
        {SRS_SECTIONS.map((section) => (
          <SectionRow
            key={section.id}
            section={section}
            selected={selectedSections}
            expanded={!!expanded[section.id]}
            disabledIds={disabledIds}
            onToggleExpand={() => toggleExpand(section.id)}
            onToggleSection={toggleSection}
            onToggleChild={toggleChild}
            onOpenToolModal={onOpenToolModal}
          />
        ))}
      </div>
    </div>
  );
}

export default SrsChecklist;
