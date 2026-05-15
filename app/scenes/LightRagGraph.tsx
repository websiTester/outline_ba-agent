import { observer } from "mobx-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import DocumentManager from "./LightRagGraph/DocumentManager";
import KnowledgeGraphViewer from "./LightRagGraph/KnowledgeGraphViewer";

const TABS = [
  { id: "documents", label: "Documents" },
  { id: "knowledge-graph", label: "Knowledge Graph" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function LightRagGraph() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("documents");

  return (
    <div className="w-full min-h-screen bg-white dark:bg-[#111319]">
      {/* Tab bar */}
      <div className="flex items-center justify-center h-14 border-b border-gray-200 dark:border-[#2a2f3e]">
        <nav className="flex h-9 items-center">
          <div className="flex h-full gap-1 p-1 bg-gray-100 dark:bg-[#1f232e] rounded-lg">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={`
                  px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-150 cursor-pointer
                  focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-1
                  ${activeTab === tab.id
                    ? "bg-emerald-400 text-white shadow-sm"
                    : "text-gray-600 dark:text-[#E6E6E6] hover:bg-white/70 dark:hover:bg-[#2a2f3e]/70"
                  }
                `}
              >
                {t(tab.label)}
              </button>
            ))}
          </div>
        </nav>
      </div>

      {/* Content */}
      <div className="px-8 py-6">
        {activeTab === "documents" && <DocumentManager />}
        {activeTab === "knowledge-graph" && <KnowledgeGraphViewer />}
      </div>
    </div>
  );
}

export default observer(LightRagGraph);
