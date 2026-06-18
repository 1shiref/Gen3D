import { useEffect, useRef, useState } from "react";
import { Keyboard, HelpCircle } from "lucide-react";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useProjectAutosave } from "@/hooks/useProjectAutosave";
import { openMostRecentOrNew } from "@/lib/project-actions";
import ProjectMenu from "@/components/Project/ProjectMenu";
import InputPanel from "@/components/InputPanel";
import ModelViewer from "@/components/ModelViewer";
import EditPanel from "@/components/EditPanel";
import ExportPanel from "@/components/ExportPanel";
import Toaster from "@/components/UI/Toaster";
import ThemeToggle from "@/components/UI/ThemeToggle";
import AIStatusBadge from "@/components/UI/AIStatusBadge";
import KeyboardShortcuts from "@/components/UI/KeyboardShortcuts";
import GuidedTour from "@/components/UI/GuidedTour";
import PrinterManagerModal from "@/components/Printer/PrinterManagerModal";
import MachineSettingsModal from "@/components/Printer/MachineSettingsModal";
import HelpTip from "@/components/UI/HelpTip";

export default function App() {
  useKeyboard();
  useProjectAutosave();
  const [exportExpanded, setExportExpanded] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // On first mount, open the most-recent project (or start a fresh one).
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void openMostRecentOrNew();
  }, []);

  useEffect(() => {
    const onExport = () => setExportExpanded(true);
    const onShortcuts = () => setShortcutsOpen(true);
    document.addEventListener("t2p:export", onExport);
    document.addEventListener("t2p:shortcuts", onShortcuts);
    return () => {
      document.removeEventListener("t2p:export", onExport);
      document.removeEventListener("t2p:shortcuts", onShortcuts);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0 z-10">
        <div className="flex items-center gap-3">
          <a
            href={`//${location.hostname}/`}
            title="Back to Mainsail"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
          >
            ← Mainsail
          </a>
          <span className="h-5 w-px bg-border" />
          <span className="text-lg font-bold text-primary">Gen3D</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">AI 3D Model Generator</span>
          <span className="h-5 w-px bg-border" />
          <ProjectMenu />
        </div>
        <div className="flex items-center gap-2">
          <AIStatusBadge />
          <button
            onClick={() => document.dispatchEvent(new CustomEvent("t2p:tour"))}
            title="Take the guided tour"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            Tour
          </button>
          <button
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard shortcuts"
            className="text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
          >
            <Keyboard className="w-4 h-4" />
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Input Panel */}
        <div data-tour="input" className="w-72 shrink-0 border-r border-border overflow-y-auto bg-card">
          <InputPanel />
        </div>

        {/* Center + Right: Viewer + Edit stacked */}
        <div className="flex flex-1 overflow-hidden flex-col">
          {/* Top: Viewer + Edit Panel side by side */}
          <div className="flex flex-1 overflow-hidden">
            {/* Center: 3D Viewer */}
            <div data-tour="viewer" className="flex-1 overflow-hidden relative">
              <ModelViewer />
            </div>

            {/* Right: Edit Panel */}
            <div data-tour="edit" className="w-80 shrink-0 border-l border-border overflow-hidden bg-card flex flex-col">
              <EditPanel />
            </div>
          </div>

          {/* Bottom: Export Panel (collapsible) */}
          <div
            data-tour="export"
            className={`border-t border-border bg-card transition-all duration-300 shrink-0 ${
              exportExpanded ? "h-64" : "h-10"
            }`}
          >
            <div className="w-full h-10 flex items-center px-4 hover:bg-accent">
              <button
                onClick={() => setExportExpanded((v) => !v)}
                className="flex-1 h-full flex items-center justify-between text-sm font-medium"
              >
                <span>G-Code Export</span>
                <span className="text-muted-foreground">{exportExpanded ? "▼" : "▲"}</span>
              </button>
              <div className="pl-3">
                <HelpTip id="export" />
              </div>
            </div>
            {exportExpanded && (
              <div className="h-[calc(100%-2.5rem)] overflow-y-auto">
                <ExportPanel />
              </div>
            )}
          </div>
        </div>
      </div>

      <Toaster />
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <PrinterManagerModal />
      <MachineSettingsModal />
      <GuidedTour />
    </div>
  );
}
