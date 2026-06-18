import { useExportStore } from "@/stores/exportStore";
import { Clock, Box, Layers } from "lucide-react";

export default function SliceStats() {
  const stats = useExportStore((s) => s.sliceStats);

  if (!stats) return null;

  return (
    <div className="grid grid-cols-3 gap-2">
      {[
        { icon: Layers, label: "Layers", value: stats.layerCount.toString() },
        { icon: Clock, label: "Est. Time", value: `${stats.estimatedTimeMinutes} min` },
        { icon: Box, label: "Filament", value: `${stats.filamentUsageGrams}g` },
      ].map(({ icon: Icon, label, value }) => (
        <div key={label} className="bg-muted rounded p-2 text-center">
          <Icon className="w-3 h-3 mx-auto mb-0.5 text-muted-foreground" />
          <p className="text-xs font-medium">{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </div>
      ))}
    </div>
  );
}
