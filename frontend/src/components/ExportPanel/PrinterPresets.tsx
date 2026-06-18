import PrinterSelect from "@/components/Printer/PrinterSelect";
import HelpTip from "@/components/UI/HelpTip";

export default function PrinterPresets() {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Printer</label>
        <HelpTip id="printer" />
      </div>
      <div className="mt-1">
        <PrinterSelect size="md" />
      </div>
    </div>
  );
}
