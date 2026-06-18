import SlicerSettings from "./SlicerSettings";
import PrinterPresets from "./PrinterPresets";
import SliceButton from "./SliceButton";
import SliceStats from "./SliceStats";
import GcodePreview from "./GcodePreview";
import DownloadButtons from "./DownloadButtons";
import SizeWarning from "./SizeWarning";
import ProcessLog from "@/components/ProcessLog";
import { useExportStore } from "@/stores/exportStore";

export default function ExportPanel() {
  const slicing = useExportStore((s) => s.sliceStatus === "slicing");
  return (
    <div className="flex gap-4 p-3 h-full overflow-x-auto">
      {/* Settings column */}
      <div className="shrink-0 w-72 space-y-3">
        <PrinterPresets />
        <SlicerSettings />
        <SizeWarning />
        <SliceButton />
        {slicing && <ProcessLog variant="inline" showWhenIdle={false} />}
        <SliceStats />
      </div>

      {/* Download + Preview column */}
      <div className="flex-1 min-w-0 space-y-3">
        <DownloadButtons />
        <GcodePreview />
      </div>
    </div>
  );
}
