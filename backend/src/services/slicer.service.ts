import { execSync, spawn } from "child_process";
import fs from "fs";
import { config } from "../config";
import { tempPath } from "../utils/file-helpers";
import { logger } from "../utils/logger";
import { sliceStl as tsSlice } from "./ts-slicer";

export type Material = "PLA" | "PETG" | "ABS" | "TPU";
export type InfillPattern = "lines" | "grid" | "triangles" | "concentric" | "zigzag";
export type CombingMode = "off" | "all" | "noskin";
export type SupportStructure = "normal" | "tree";
export type SupportPlacement = "everywhere" | "touching-buildplate";
export type AdhesionType = "none" | "skirt" | "brim" | "raft";

/**
 * Full Cura-style print profile. Every field is consumed by the slicer (see ts-slicer/
 * for the pure-TS engine, and sliceWithCura/sliceWithPrusa for external engines).
 */
export interface SlicerSettings {
  // Quality
  layerHeight: number;
  initialLayerHeight: number;

  // Walls
  wallLineCount: number;
  wallThickness: number;
  horizontalExpansion: number;

  // Top / Bottom
  topLayers: number;
  bottomLayers: number;
  topBottomThickness: number;

  // Infill
  infillDensity: number;
  infillPattern: InfillPattern;

  // Material
  material: Material;
  printingTemperature: number;
  buildPlateTemperature: number;
  buildPlateTemperatureInitialLayer: number;
  flow: number;
  initialLayerFlow: number;

  // Speed
  printSpeed: number;
  supportSpeed: number;
  travelSpeed: number;
  initialLayerSpeed: number;
  enableAccelerationControl: boolean;
  enableTravelAcceleration: boolean;
  printAcceleration: number;
  travelAcceleration: number;
  enableJerkControl: boolean;
  printJerk: number;

  // Travel
  enableRetraction: boolean;
  retractionDistance: number;
  retractionSpeed: number;
  combingMode: CombingMode;
  avoidPrintedPartsWhenTraveling: boolean;
  zHopWhenRetracted: boolean;
  zHopHeight: number;

  // Cooling
  enablePrintCooling: boolean;
  fanSpeed: number;
  initialFanSpeed: number;
  minimumLayerTime: number;

  // Support
  generateSupport: boolean;
  supportStructure: SupportStructure;
  supportPlacement: SupportPlacement;
  supportOverhangAngle: number;
  supportPattern: InfillPattern;
  supportDensity: number;
  supportZDistance: number;
  supportXYDistance: number;
  supportHorizontalExpansion: number;
  enableSupportInterface: boolean;
  supportInterfaceThickness: number;
  supportInterfaceDensity: number;

  // Build Plate Adhesion
  buildPlateAdhesionType: AdhesionType;
  skirtLineCount: number;
  skirtDistance: number;
  brimWidth: number;

  // Machine / extrusion (not user-facing in the recommended view)
  lineWidth: number;
  nozzleDiameter: number;
  filamentDiameter: number;

  /** Active printer id, for the G-code header comment only. */
  printerPreset?: string;
}

/** Machine (printer) settings that affect the emitted G-code. */
export interface MachineProfile {
  name?: string;
  bedWidth?: number;
  bedDepth?: number;
  bedHeight?: number;
  originAtCenter?: boolean;
  gcodeFlavor?: string;
  nozzleSize?: number;
  filamentDiameter?: number;
  coolingFanNumber?: number;
  startGcode?: string;
  endGcode?: string;
  // Printhead silhouette offsets from the nozzle (Cura head polygon) + gantry
  // height. Used to inset the reachable print area and as a Z clearance limit.
  headXMin?: number;
  headYMin?: number;
  headXMax?: number;
  headYMax?: number;
  gantryHeight?: number;
}

/**
 * The built-in "Gen 3D PETG Normal" profile — the factory default. The slice route
 * fills any omitted field from here, so partial overrides from the UI always resolve
 * to a complete profile.
 */
export const FACTORY_PROFILE: SlicerSettings = {
  layerHeight: 0.24,
  initialLayerHeight: 0.3,

  wallLineCount: 2,
  wallThickness: 0.8,
  horizontalExpansion: 0.0,

  topLayers: 4,
  bottomLayers: 4,
  topBottomThickness: 0.8,

  infillDensity: 30,
  infillPattern: "lines",

  material: "PETG",
  printingTemperature: 260,
  buildPlateTemperature: 80,
  buildPlateTemperatureInitialLayer: 80,
  flow: 100,
  initialLayerFlow: 110,

  printSpeed: 60,
  supportSpeed: 45,
  travelSpeed: 120,
  initialLayerSpeed: 20,
  enableAccelerationControl: true,
  enableTravelAcceleration: true,
  printAcceleration: 1500,
  travelAcceleration: 1500,
  enableJerkControl: true,
  printJerk: 8.0,

  enableRetraction: true,
  retractionDistance: 5.0,
  retractionSpeed: 45,
  combingMode: "all",
  avoidPrintedPartsWhenTraveling: true,
  zHopWhenRetracted: false,
  zHopHeight: 0.2,

  enablePrintCooling: true,
  fanSpeed: 30,
  initialFanSpeed: 0,
  minimumLayerTime: 3.0,

  generateSupport: true,
  supportStructure: "normal",
  supportPlacement: "everywhere",
  supportOverhangAngle: 50,
  supportPattern: "zigzag",
  supportDensity: 8,
  supportZDistance: 0.7,
  supportXYDistance: 1.3,
  supportHorizontalExpansion: 0.8,
  enableSupportInterface: true,
  supportInterfaceThickness: 0.6,
  supportInterfaceDensity: 12,

  buildPlateAdhesionType: "skirt",
  skirtLineCount: 3,
  skirtDistance: 3.0,
  brimWidth: 8.0,

  lineWidth: 0.4,
  nozzleDiameter: 0.4,
  filamentDiameter: 1.75,
};

export interface SliceResult {
  gcodeContent: string;
  layerCount: number;
  estimatedTimeMinutes: number;
  filamentUsageMm: number;
  filamentUsageGrams: number;
  /** Non-fatal issues (e.g. model larger than the build volume). */
  warnings?: string[];
}

type SlicerBackend = "cura" | "prusa" | "ts-fallback" | "none";

let detectedSlicer: SlicerBackend | null = null;

function detectSlicer(): SlicerBackend {
  if (detectedSlicer !== null) return detectedSlicer;

  if (config.slicerPath) {
    try {
      execSync(`"${config.slicerPath}" --version`, { stdio: "pipe" });
      const name = config.slicerPath.toLowerCase();
      detectedSlicer = name.includes("cura") ? "cura" : "prusa";
      return detectedSlicer;
    } catch {}
  }

  try { execSync("CuraEngine --version", { stdio: "pipe" }); detectedSlicer = "cura"; return detectedSlicer; } catch {}
  try { execSync("prusa-slicer --version", { stdio: "pipe" }); detectedSlicer = "prusa"; return detectedSlicer; } catch {}
  try { execSync("PrusaSlicer --version", { stdio: "pipe" }); detectedSlicer = "prusa"; return detectedSlicer; } catch {}

  detectedSlicer = "ts-fallback";
  return detectedSlicer;
}

export function getSlicerBackend(): SlicerBackend {
  return detectSlicer();
}

export async function sliceToGcode(
  stlPath: string,
  settings: SlicerSettings,
  machine?: MachineProfile,
): Promise<SliceResult> {
  const backend = detectSlicer();
  logger.info(`Slicing with backend: ${backend}`);

  if (backend === "cura") {
    return sliceWithCura(stlPath, settings, machine);
  }

  if (backend === "prusa") {
    return sliceWithPrusa(stlPath, settings, machine);
  }

  return tsSlice(stlPath, settings, machine);
}

async function sliceWithCura(stlPath: string, settings: SlicerSettings, machine?: MachineProfile): Promise<SliceResult> {
  const gcodePath = tempPath(".gcode");
  const cmd = config.slicerPath || "CuraEngine";

  await new Promise<void>((resolve, reject) => {
    const curaPattern: Record<InfillPattern, string> = {
      lines: "lines", grid: "grid", triangles: "triangles",
      concentric: "concentric", zigzag: "zigzag",
    };
    const args = [
      "slice", "-v",
      "-j", "/usr/share/cura/resources/definitions/fdmprinter.def.json",
      "-s", `layer_height=${settings.layerHeight}`,
      "-s", `layer_height_0=${settings.initialLayerHeight}`,
      "-s", `wall_line_count=${settings.wallLineCount}`,
      "-s", `top_layers=${settings.topLayers}`,
      "-s", `bottom_layers=${settings.bottomLayers}`,
      "-s", `infill_sparse_density=${settings.infillDensity}`,
      "-s", `infill_pattern=${curaPattern[settings.infillPattern]}`,
      "-s", `material_print_temperature=${settings.printingTemperature}`,
      "-s", `material_print_temperature_layer_0=${settings.printingTemperature}`,
      "-s", `material_bed_temperature=${settings.buildPlateTemperature}`,
      "-s", `material_bed_temperature_layer_0=${settings.buildPlateTemperatureInitialLayer}`,
      "-s", `material_flow=${settings.flow}`,
      "-s", `material_flow_layer_0=${settings.initialLayerFlow}`,
      "-s", `speed_print=${settings.printSpeed}`,
      "-s", `speed_travel=${settings.travelSpeed}`,
      "-s", `speed_layer_0=${settings.initialLayerSpeed}`,
      "-s", `speed_support=${settings.supportSpeed}`,
      "-s", `acceleration_enabled=${settings.enableAccelerationControl}`,
      "-s", `acceleration_print=${settings.printAcceleration}`,
      "-s", `acceleration_travel=${settings.travelAcceleration}`,
      "-s", `jerk_enabled=${settings.enableJerkControl}`,
      "-s", `jerk_print=${settings.printJerk}`,
      "-s", `retraction_enable=${settings.enableRetraction}`,
      "-s", `retraction_amount=${settings.retractionDistance}`,
      "-s", `retraction_speed=${settings.retractionSpeed}`,
      "-s", `retraction_hop_enabled=${settings.zHopWhenRetracted}`,
      "-s", `cool_fan_enabled=${settings.enablePrintCooling}`,
      "-s", `cool_fan_speed=${settings.fanSpeed}`,
      "-s", `cool_min_layer_time=${settings.minimumLayerTime}`,
      "-s", `support_enable=${settings.generateSupport}`,
      "-s", `support_angle=${settings.supportOverhangAngle}`,
      "-s", `support_pattern=${curaPattern[settings.supportPattern]}`,
      "-s", `support_infill_rate=${settings.supportDensity}`,
      "-s", `support_z_distance=${settings.supportZDistance}`,
      "-s", `support_xy_distance=${settings.supportXYDistance}`,
      "-s", `support_interface_enable=${settings.enableSupportInterface}`,
      "-s", `adhesion_type=${settings.buildPlateAdhesionType}`,
      "-s", `skirt_line_count=${settings.skirtLineCount}`,
      "-s", `brim_width=${settings.brimWidth}`,
    ];
    if (machine) {
      if (machine.bedWidth) args.push("-s", `machine_width=${machine.bedWidth}`);
      if (machine.bedDepth) args.push("-s", `machine_depth=${machine.bedDepth}`);
      if (machine.bedHeight) args.push("-s", `machine_height=${machine.bedHeight}`);
      if (machine.originAtCenter !== undefined) args.push("-s", `machine_center_is_zero=${machine.originAtCenter}`);
      if (machine.gcodeFlavor) args.push("-s", `machine_gcode_flavor=${machine.gcodeFlavor}`);
      if (machine.nozzleSize) args.push("-s", `machine_nozzle_size=${machine.nozzleSize}`);
      if (machine.filamentDiameter) args.push("-s", `material_diameter=${machine.filamentDiameter}`);
      if (machine.startGcode) args.push("-s", `machine_start_gcode=${machine.startGcode}`);
      if (machine.endGcode) args.push("-s", `machine_end_gcode=${machine.endGcode}`);
    }
    args.push("-l", stlPath, "-o", gcodePath);
    const proc = spawn(cmd, args);
    proc.on("error", reject);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`CuraEngine exited ${code}`)));
  });

  const gcodeContent = fs.readFileSync(gcodePath, "utf-8");
  fs.unlinkSync(gcodePath);

  const layerCount = (gcodeContent.match(/;LAYER:/g) ?? []).length;
  return { gcodeContent, layerCount, estimatedTimeMinutes: 0, filamentUsageMm: 0, filamentUsageGrams: 0 };
}

async function sliceWithPrusa(stlPath: string, settings: SlicerSettings, machine?: MachineProfile): Promise<SliceResult> {
  const gcodePath = tempPath(".gcode");
  const cmd = config.slicerPath || "prusa-slicer";

  await new Promise<void>((resolve, reject) => {
    const prusaPattern: Record<InfillPattern, string> = {
      lines: "rectilinear", grid: "grid", triangles: "triangles",
      concentric: "concentric", zigzag: "rectilinear",
    };
    const args = [
      "--export-gcode",
      `--layer-height=${settings.layerHeight}`,
      `--first-layer-height=${settings.initialLayerHeight}`,
      `--perimeters=${settings.wallLineCount}`,
      `--top-solid-layers=${settings.topLayers}`,
      `--bottom-solid-layers=${settings.bottomLayers}`,
      `--fill-density=${settings.infillDensity}%`,
      `--fill-pattern=${prusaPattern[settings.infillPattern]}`,
      `--temperature=${settings.printingTemperature}`,
      `--first-layer-temperature=${settings.printingTemperature}`,
      `--bed-temperature=${settings.buildPlateTemperature}`,
      `--first-layer-bed-temperature=${settings.buildPlateTemperatureInitialLayer}`,
      `--extrusion-multiplier=${settings.flow / 100}`,
      `--perimeter-speed=${settings.printSpeed}`,
      `--travel-speed=${settings.travelSpeed}`,
      `--support-material-speed=${settings.supportSpeed}`,
      `--retract-length=${settings.retractionDistance}`,
      `--retract-speed=${settings.retractionSpeed}`,
      `--retract-lift=${settings.zHopWhenRetracted ? settings.zHopHeight : 0}`,
      `--fan-always-on=${settings.enablePrintCooling ? "1" : "0"}`,
      `--max-fan-speed=${settings.fanSpeed}`,
      `--slowdown-below-layer-time=${settings.minimumLayerTime}`,
      `--support-material=${settings.generateSupport ? "1" : "0"}`,
      `--support-material-angle=${settings.supportOverhangAngle}`,
      `--support-material-contact-distance=${settings.supportZDistance}`,
      `--skirts=${settings.buildPlateAdhesionType === "skirt" ? settings.skirtLineCount : 0}`,
      `--brim-width=${settings.buildPlateAdhesionType === "brim" ? settings.brimWidth : 0}`,
    ];
    if (machine) {
      if (machine.bedWidth && machine.bedDepth) args.push(`--bed-shape=0x0,${machine.bedWidth}x0,${machine.bedWidth}x${machine.bedDepth},0x${machine.bedDepth}`);
      if (machine.nozzleSize) args.push(`--nozzle-diameter=${machine.nozzleSize}`);
      if (machine.filamentDiameter) args.push(`--filament-diameter=${machine.filamentDiameter}`);
      if (machine.gcodeFlavor) args.push(`--gcode-flavor=${machine.gcodeFlavor.toLowerCase().split(" ")[0]}`);
      if (machine.startGcode) args.push(`--start-gcode=${machine.startGcode}`);
      if (machine.endGcode) args.push(`--end-gcode=${machine.endGcode}`);
    }
    args.push(`--output=${gcodePath}`, stlPath);
    const proc = spawn(cmd, args);
    proc.on("error", reject);
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`PrusaSlicer exited ${code}`)));
  });

  const gcodeContent = fs.readFileSync(gcodePath, "utf-8");
  fs.unlinkSync(gcodePath);

  const layerCount = (gcodeContent.match(/;LAYER_CHANGE/g) ?? []).length;
  return { gcodeContent, layerCount, estimatedTimeMinutes: 0, filamentUsageMm: 0, filamentUsageGrams: 0 };
}
