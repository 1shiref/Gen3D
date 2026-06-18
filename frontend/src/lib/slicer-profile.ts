/**
 * The full slicer print profile shared with the backend (mirror of
 * backend/src/services/slicer.service.ts SlicerSettings + FACTORY_PROFILE).
 * Plus UI metadata (SETTING_GROUPS) that drives the Custom settings view.
 */
import type { Material } from "@/lib/constants";

export type InfillPattern = "lines" | "grid" | "triangles" | "concentric" | "zigzag";
export type CombingMode = "off" | "all" | "noskin";
export type SupportStructure = "normal" | "tree";
export type SupportPlacement = "everywhere" | "touching-buildplate";
export type AdhesionType = "none" | "skirt" | "brim" | "raft";

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
  // Machine / extrusion
  lineWidth: number;
  nozzleDiameter: number;
  filamentDiameter: number;
}

/** Built-in "Gen 3D PETG Normal" profile — the factory reset target. */
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

// ---------------------------------------------------------------------------
// UI metadata — drives the Custom settings view (and validates Recommended).
// ---------------------------------------------------------------------------

export type FieldType = "number" | "int" | "bool" | "select";

export interface FieldMeta {
  key: keyof SlicerSettings;
  label: string;
  type: FieldType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** Only show when this other boolean field is enabled. */
  showIf?: keyof SlicerSettings;
}

export interface SettingGroup {
  name: string;
  fields: FieldMeta[];
}

const PATTERN_OPTIONS = [
  { value: "lines", label: "Lines" },
  { value: "grid", label: "Grid" },
  { value: "triangles", label: "Triangles" },
  { value: "concentric", label: "Concentric" },
  { value: "zigzag", label: "Zig Zag" },
];

export const MATERIAL_OPTIONS = [
  { value: "PLA", label: "PLA" },
  { value: "PETG", label: "PETG" },
  { value: "ABS", label: "ABS" },
  { value: "TPU", label: "TPU" },
];

export const SETTING_GROUPS: SettingGroup[] = [
  {
    name: "Quality",
    fields: [
      { key: "layerHeight", label: "Layer Height", type: "number", unit: "mm", min: 0.05, max: 0.6, step: 0.01 },
      { key: "initialLayerHeight", label: "Initial Layer Height", type: "number", unit: "mm", min: 0.05, max: 0.8, step: 0.01 },
    ],
  },
  {
    name: "Walls",
    fields: [
      { key: "wallThickness", label: "Wall Thickness", type: "number", unit: "mm", min: 0.4, max: 5, step: 0.1 },
      { key: "wallLineCount", label: "Wall Line Count", type: "int", min: 0, max: 10, step: 1 },
      { key: "horizontalExpansion", label: "Horizontal Expansion", type: "number", unit: "mm", min: -2, max: 2, step: 0.1 },
    ],
  },
  {
    name: "Top/Bottom",
    fields: [
      { key: "topBottomThickness", label: "Top/Bottom Thickness", type: "number", unit: "mm", min: 0, max: 5, step: 0.1 },
      { key: "topLayers", label: "Top Layers", type: "int", min: 0, max: 20, step: 1 },
      { key: "bottomLayers", label: "Bottom Layers", type: "int", min: 0, max: 20, step: 1 },
    ],
  },
  {
    name: "Infill",
    fields: [
      { key: "infillDensity", label: "Infill Density", type: "number", unit: "%", min: 0, max: 100, step: 5 },
      { key: "infillPattern", label: "Infill Pattern", type: "select", options: PATTERN_OPTIONS },
    ],
  },
  {
    name: "Material",
    fields: [
      { key: "material", label: "Material", type: "select", options: MATERIAL_OPTIONS },
      { key: "printingTemperature", label: "Printing Temperature", type: "number", unit: "°C", min: 150, max: 320, step: 1 },
      { key: "buildPlateTemperature", label: "Build Plate Temperature", type: "number", unit: "°C", min: 0, max: 130, step: 1 },
      { key: "buildPlateTemperatureInitialLayer", label: "Build Plate Temperature Initial Layer", type: "number", unit: "°C", min: 0, max: 130, step: 1 },
      { key: "flow", label: "Flow", type: "number", unit: "%", min: 50, max: 150, step: 1 },
      { key: "initialLayerFlow", label: "Initial Layer Flow", type: "number", unit: "%", min: 50, max: 200, step: 1 },
    ],
  },
  {
    name: "Speed",
    fields: [
      { key: "printSpeed", label: "Print Speed", type: "number", unit: "mm/s", min: 5, max: 300, step: 1 },
      { key: "supportSpeed", label: "Support Speed", type: "number", unit: "mm/s", min: 5, max: 300, step: 1 },
      { key: "travelSpeed", label: "Travel Speed", type: "number", unit: "mm/s", min: 5, max: 500, step: 1 },
      { key: "initialLayerSpeed", label: "Initial Layer Speed", type: "number", unit: "mm/s", min: 5, max: 100, step: 1 },
      { key: "enableAccelerationControl", label: "Enable Acceleration Control", type: "bool" },
      { key: "enableTravelAcceleration", label: "Enable Travel Acceleration", type: "bool", showIf: "enableAccelerationControl" },
      { key: "printAcceleration", label: "Print Acceleration", type: "number", unit: "mm/s²", min: 100, max: 10000, step: 50, showIf: "enableAccelerationControl" },
      { key: "travelAcceleration", label: "Travel Acceleration", type: "number", unit: "mm/s²", min: 100, max: 10000, step: 50, showIf: "enableAccelerationControl" },
      { key: "enableJerkControl", label: "Enable Jerk Control", type: "bool" },
      { key: "printJerk", label: "Print Jerk", type: "number", unit: "mm/s", min: 1, max: 50, step: 0.5, showIf: "enableJerkControl" },
    ],
  },
  {
    name: "Travel",
    fields: [
      { key: "enableRetraction", label: "Enable Retraction", type: "bool" },
      { key: "retractionDistance", label: "Retraction Distance", type: "number", unit: "mm", min: 0, max: 15, step: 0.1, showIf: "enableRetraction" },
      { key: "retractionSpeed", label: "Retraction Speed", type: "number", unit: "mm/s", min: 5, max: 100, step: 1, showIf: "enableRetraction" },
      { key: "combingMode", label: "Combing Mode", type: "select", options: [
        { value: "off", label: "Off" }, { value: "all", label: "All" }, { value: "noskin", label: "Not in Skin" },
      ] },
      { key: "avoidPrintedPartsWhenTraveling", label: "Avoid Printed Parts When Traveling", type: "bool" },
      { key: "zHopWhenRetracted", label: "Z Hop When Retracted", type: "bool" },
      { key: "zHopHeight", label: "Z Hop Height", type: "number", unit: "mm", min: 0, max: 2, step: 0.05, showIf: "zHopWhenRetracted" },
    ],
  },
  {
    name: "Cooling",
    fields: [
      { key: "enablePrintCooling", label: "Enable Print Cooling", type: "bool" },
      { key: "fanSpeed", label: "Fan Speed", type: "number", unit: "%", min: 0, max: 100, step: 1, showIf: "enablePrintCooling" },
      { key: "initialFanSpeed", label: "Initial Fan Speed", type: "number", unit: "%", min: 0, max: 100, step: 1, showIf: "enablePrintCooling" },
      { key: "minimumLayerTime", label: "Minimum Layer Time", type: "number", unit: "s", min: 0, max: 30, step: 0.5 },
    ],
  },
  {
    name: "Support",
    fields: [
      { key: "generateSupport", label: "Generate Support", type: "bool" },
      { key: "supportStructure", label: "Support Structure", type: "select", showIf: "generateSupport", options: [
        { value: "normal", label: "Normal" }, { value: "tree", label: "Tree" },
      ] },
      { key: "supportPlacement", label: "Support Placement", type: "select", showIf: "generateSupport", options: [
        { value: "everywhere", label: "Everywhere" }, { value: "touching-buildplate", label: "Touching Buildplate" },
      ] },
      { key: "supportOverhangAngle", label: "Support Overhang Angle", type: "number", unit: "°", min: 0, max: 89, step: 1, showIf: "generateSupport" },
      { key: "supportPattern", label: "Support Pattern", type: "select", options: PATTERN_OPTIONS, showIf: "generateSupport" },
      { key: "supportDensity", label: "Support Density", type: "number", unit: "%", min: 0, max: 100, step: 1, showIf: "generateSupport" },
      { key: "supportZDistance", label: "Support Z Distance", type: "number", unit: "mm", min: 0, max: 2, step: 0.05, showIf: "generateSupport" },
      { key: "supportXYDistance", label: "Support X/Y Distance", type: "number", unit: "mm", min: 0, max: 3, step: 0.05, showIf: "generateSupport" },
      { key: "supportHorizontalExpansion", label: "Support Horizontal Expansion", type: "number", unit: "mm", min: 0, max: 3, step: 0.05, showIf: "generateSupport" },
      { key: "enableSupportInterface", label: "Enable Support Interface", type: "bool", showIf: "generateSupport" },
      { key: "supportInterfaceThickness", label: "Support Interface Thickness", type: "number", unit: "mm", min: 0, max: 2, step: 0.05, showIf: "generateSupport" },
      { key: "supportInterfaceDensity", label: "Support Interface Density", type: "number", unit: "%", min: 0, max: 100, step: 1, showIf: "generateSupport" },
    ],
  },
  {
    name: "Build Plate Adhesion",
    fields: [
      { key: "buildPlateAdhesionType", label: "Build Plate Adhesion Type", type: "select", options: [
        { value: "none", label: "None" }, { value: "skirt", label: "Skirt" },
        { value: "brim", label: "Brim" }, { value: "raft", label: "Raft" },
      ] },
      { key: "skirtLineCount", label: "Skirt Line Count", type: "int", min: 0, max: 10, step: 1 },
      { key: "skirtDistance", label: "Skirt Distance", type: "number", unit: "mm", min: 0, max: 10, step: 0.5 },
      { key: "brimWidth", label: "Brim Width", type: "number", unit: "mm", min: 0, max: 20, step: 0.5 },
    ],
  },
];
