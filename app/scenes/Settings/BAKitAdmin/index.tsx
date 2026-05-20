/**
 * BA Kit Admin — Settings sub-page.
 *
 * Top-level shell with two tabs (Templates / Sections & Agents). Visible only
 * when `user.isInstanceAdmin === true` (gating done in useSettingsConfig).
 *
 * Visual language matches the BA Kit gallery page: minimal, white surfaces,
 * single blue accent, slate text scale.
 */

import { observer } from "mobx-react";
import { useEffect, useState } from "react";
import * as api from "~/scenes/BAKit/api";
import type { TemplateDetail, TemplateSummary } from "~/scenes/BAKit/types";
import SectionsTab from "./SectionsTab";
import TemplatesTab from "./TemplatesTab";

type Tab = "templates" | "sections";

function BAKitAdmin() {
  const [tab, setTab] = useState<Tab>("templates");
  // Admin list (includes disabled templates) — separate from the public store.
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState<TemplateDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // step 1: fetch admin template list once on mount
  useEffect(() => {
    void (async () => {
      setLoadingList(true);
      try {
        const list = await api.listAdminTemplates();
        setTemplates(list);
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  // step 2: load detail when admin opens a row in TemplatesTab
  const loadDetail = async (id: string) => {
    setLoadingDetail(true);
    try {
      const detail = await api.getAdminTemplate(id);
      setSelected(detail);
      setTab("sections");
    } finally {
      setLoadingDetail(false);
    }
  };

  const refreshList = async () => {
    const list = await api.listAdminTemplates();
    setTemplates(list);
  };

  return (
    // `w-full` is required because Outline's Settings layout flex-centers its
    // children (see Layout.tsx `<Content justify="center">`). Without it the
    // scene collapses to natural content width. `max-w-screen-2xl` caps the
    // working area at 1536px so the system-prompt textarea and the sections
    // sidebar both get plenty of room.
    <div className="w-full max-w-screen-2xl mx-auto py-8 px-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            BA Kit Admin
          </h1>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-[10px] font-medium text-blue-700">
            Instance admin
          </span>
        </div>
        <p className="mt-1.5 text-sm text-slate-500">
          Instance-level template &amp; agent configuration. Changes apply to every workspace.
        </p>
      </header>

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <nav className="flex border-b border-slate-200 mb-6">
        <TabButton active={tab === "templates"} onClick={() => setTab("templates")}>
          Templates
        </TabButton>
        <TabButton
          active={tab === "sections"}
          disabled={!selected}
          onClick={() => setTab("sections")}
          // Compact secondary label so the active tab tells admin which template they're editing
          secondary={selected ? selected.code : undefined}
        >
          Sections &amp; Agents
        </TabButton>
      </nav>

      {/* ── Active tab content ─────────────────────────────────────────────── */}
      {tab === "templates" && (
        <TemplatesTab
          templates={templates}
          loading={loadingList}
          onOpen={loadDetail}
          onRefresh={refreshList}
        />
      )}
      {tab === "sections" && selected && (
        <SectionsTab
          template={selected}
          loading={loadingDetail}
          onUpdated={async () => {
            const fresh = await api.getAdminTemplate(selected.id);
            setSelected(fresh);
          }}
        />
      )}
      {tab === "sections" && !selected && (
        // Edge case: user lands directly on the sections tab via URL/state.
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 py-10 text-center">
          <p className="text-sm text-slate-500">
            Open a template from the <button
              type="button"
              onClick={() => setTab("templates")}
              className="text-blue-600 hover:underline cursor-pointer"
            >Templates</button> tab to edit its sections.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Pill-less tab button — flat underline, no fill. `secondary` shows a small
 * code (e.g. PRD) under the label when one is selected.
 */
function TabButton({
  active,
  disabled,
  children,
  secondary,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  secondary?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`-mb-px px-4 py-2.5 border-b-2 text-sm font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1 ${
        active
          ? "border-blue-500 text-blue-600"
          : "border-transparent text-slate-500 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
      }`}
    >
      <span className="flex items-baseline gap-2">
        {children}
        {secondary && (
          <span className="text-[11px] font-normal text-slate-400">
            · {secondary}
          </span>
        )}
      </span>
    </button>
  );
}

export default observer(BAKitAdmin);
