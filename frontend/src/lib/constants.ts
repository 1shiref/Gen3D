export type ViewMode = "solid";
export type Material = "PLA" | "PETG" | "ABS" | "TPU";
export type PrinterPreset = "ender3" | "bambu-x1c" | "prusa-mk4" | "anycubic-kobra" | "custom";

export type GenerationStatus =
  | "idle"
  | "uploading"
  | "streaming"
  | "compiling"
  | "done"
  | "error";

export const PRINTER_PRESETS: Record<PrinterPreset, {
  name: string;
  nozzleTemp: number;
  bedTemp: number;
  printSpeed: number;
}> = {
  "ender3": { name: "Ender 3", nozzleTemp: 200, bedTemp: 60, printSpeed: 50 },
  "bambu-x1c": { name: "Bambu Lab X1C", nozzleTemp: 220, bedTemp: 65, printSpeed: 200 },
  "prusa-mk4": { name: "Prusa MK4", nozzleTemp: 215, bedTemp: 60, printSpeed: 100 },
  "anycubic-kobra": { name: "Anycubic Kobra", nozzleTemp: 200, bedTemp: 55, printSpeed: 60 },
  "custom": { name: "Custom", nozzleTemp: 200, bedTemp: 60, printSpeed: 50 },
};
