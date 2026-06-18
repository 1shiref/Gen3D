export type BuildPlateShape = "rectangular" | "elliptic";
export type GcodeFlavor = "Marlin" | "RepRap" | "Griffin" | "UltiGCode" | "RepRap (Volumetric)";

export interface PrinterProfile {
  id: string;
  name: string;
  bedWidth: number;
  bedDepth: number;
  bedHeight: number;
  color: string;
  nozzleTemp: number;
  bedTemp: number;
  printSpeed: number;
  /** True for shipped presets (read-only); false/undefined for user-created printers. */
  builtIn?: boolean;

  // --- Machine settings (Cura "Machine Settings" dialog). Optional so the
  //     shipped presets keep working with sensible fallbacks. ---
  // Printer tab
  buildPlateShape?: BuildPlateShape;
  originAtCenter?: boolean;
  heatedBed?: boolean;
  heatedBuildVolume?: boolean;
  gcodeFlavor?: GcodeFlavor;
  headXMin?: number;
  headYMin?: number;
  headXMax?: number;
  headYMax?: number;
  gantryHeight?: number;
  extruderCount?: number;
  applyExtruderOffsets?: boolean;
  startGcodeFirst?: boolean;
  startGcode?: string;
  endGcode?: string;
  // Extruder 1 tab
  nozzleSize?: number;
  filamentDiameter?: number;
  nozzleOffsetX?: number;
  nozzleOffsetY?: number;
  coolingFanNumber?: number;
  extruderChangeDuration?: number;
  extruderStartDuration?: number;
  extruderEndDuration?: number;
  extruderPrestartGcode?: string;
  extruderStartGcode?: string;
  extruderEndGcode?: string;
}

/** Default Start G-code for the Gen 3D printer (Marlin). Uses Cura tokens that the
 *  slicer substitutes from the active print profile at slice time. */
const GEN3D_START_GCODE = `; ===== START GCODE (OPTIMIZED) =====
; G34 ; Auto Z Align

G28 ; Home all axes

G29 ; Auto bed leveling

M190 S{material_bed_temperature_layer_0} ; Wait for bed temp
M104 S{material_print_temperature_layer_0} ; Start nozzle heating
M109 S{material_print_temperature_layer_0} ; Wait for nozzle temp

G92 E0 ; Reset extruder
G1 Z2.0 F3000 ; Move Z up
G1 X2 Y20 Z0.3 F5000 ; Move to start
G1 X2 Y200 Z0.3 F1500 E15 ; Prime line
G92 E0 ; Reset extruder`;

const GEN3D_END_GCODE = `M104 S0
M140 S0
;Retract the filament
G92 E1
G1 E-1 F300
G28 X0 Y0
M84`;

/** Built-in default printer matching the user's Cura "Custom Gen 3D printer".
 *  Editable (builtIn: false) and seeded as the default selected printer. */
export const GEN3D_PRINTER_ID = "gen3d";

export const MACHINE_FACTORY: PrinterProfile = {
  id: GEN3D_PRINTER_ID,
  name: "Custom Gen 3D printer",
  bedWidth: 290,
  bedDepth: 290,
  bedHeight: 300,
  color: "#3b5bdb",
  // Temps match the "Gen 3D PETG Normal" print profile so selecting this printer
  // does not fight the slicer defaults.
  nozzleTemp: 260,
  bedTemp: 80,
  printSpeed: 60,
  builtIn: false,

  buildPlateShape: "rectangular",
  originAtCenter: false,
  heatedBed: true,
  heatedBuildVolume: false,
  gcodeFlavor: "Marlin",
  headXMin: -55,
  headYMin: -12,
  headXMax: 235,
  headYMax: 278,
  gantryHeight: 300,
  extruderCount: 1,
  applyExtruderOffsets: true,
  startGcodeFirst: true,
  startGcode: GEN3D_START_GCODE,
  endGcode: GEN3D_END_GCODE,

  nozzleSize: 0.4,
  filamentDiameter: 1.75,
  nozzleOffsetX: 0,
  nozzleOffsetY: 0,
  coolingFanNumber: 1,
  extruderChangeDuration: 0,
  extruderStartDuration: 0,
  extruderEndDuration: 0,
  extruderPrestartGcode: "",
  extruderStartGcode: "",
  extruderEndGcode: "",
};

/** Shipped presets. Seeded into the printer store at runtime; never persisted, so
 *  edits here always take effect even for users with saved custom printers. */
export const BUILTIN_PROFILES: PrinterProfile[] = [
  { id: "ender3", name: "Ender 3", bedWidth: 220, bedDepth: 220, bedHeight: 250, color: "#1a73e8", nozzleTemp: 200, bedTemp: 60, printSpeed: 50, builtIn: true },
  { id: "bambu-x1c", name: "Bambu Lab X1C", bedWidth: 256, bedDepth: 256, bedHeight: 256, color: "#00c853", nozzleTemp: 220, bedTemp: 65, printSpeed: 200, builtIn: true },
  { id: "prusa-mk4", name: "Prusa MK4", bedWidth: 250, bedDepth: 210, bedHeight: 220, color: "#ff6900", nozzleTemp: 215, bedTemp: 60, printSpeed: 100, builtIn: true },
  { id: "anycubic-kobra", name: "Anycubic Kobra", bedWidth: 220, bedDepth: 220, bedHeight: 250, color: "#9c27b0", nozzleTemp: 200, bedTemp: 55, printSpeed: 60, builtIn: true },
];
