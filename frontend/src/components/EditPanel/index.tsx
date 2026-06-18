import { useState } from "react";
import { Sparkles, Wrench, History } from "lucide-react";
import SmartPlan from "./SmartPlan";
import ToolsPanel from "./Tools";
import HistoryPanel from "./History";
import HelpTip from "@/components/UI/HelpTip";
import type { HelpId } from "@/lib/help-content";

type Tab = "edit" | "tools" | "history";

const TAB_HELP: Record<Tab, HelpId> = {
  edit: "smartPlan",
  tools: "tools",
  history: "history",
};

export default function EditPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("edit");

  const tabs: { id: Tab; label: string; icon: typeof Sparkles }[] = [
    { id: "edit", label: "Smart plan", icon: Sparkles },
    { id: "tools", label: "Tools", icon: Wrench },
    { id: "history", label: "History", icon: History },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border shrink-0">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === id
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
        <div className="ml-auto pr-3">
          <HelpTip id={TAB_HELP[activeTab]} />
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "edit" && <SmartPlan />}
        {activeTab === "tools" && <ToolsPanel />}
        {activeTab === "history" && <HistoryPanel />}
      </div>
    </div>
  );
}
