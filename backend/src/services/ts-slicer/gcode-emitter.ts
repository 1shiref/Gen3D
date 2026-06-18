import type { SlicerSettings, MachineProfile } from "../slicer.service";
import type { Pt, SliceLayer, FeatureType } from "./types";
import { dist } from "./geometry";

const TYPE_LABEL: Record<FeatureType, string> = {
  "wall-outer": "WALL-OUTER",
  "wall-inner": "WALL-INNER",
  "skin": "SKIN",
  "fill": "FILL",
  "support": "SUPPORT",
  "support-interface": "SUPPORT-INTERFACE",
  "skirt": "SKIRT",
  "brim": "BRIM",
};

const pct255 = (pct: number) => Math.round((Math.max(0, Math.min(100, pct)) / 100) * 255);
const f = (n: number) => n.toFixed(3);

function featureSpeed(type: FeatureType, s: SlicerSettings, isFirstLayer: boolean): number {
  if (isFirstLayer) return s.initialLayerSpeed;
  if (type === "support" || type === "support-interface") return s.supportSpeed;
  return s.printSpeed; // mm/s
}

/** Resolve Cura-style {tokens} in user Start/End G-code from the active profile. */
function substituteTokens(text: string, s: SlicerSettings, machine?: MachineProfile): string {
  const map: Record<string, string | number> = {
    material_print_temperature: s.printingTemperature,
    material_print_temperature_layer_0: s.printingTemperature,
    material_bed_temperature: s.buildPlateTemperature,
    material_bed_temperature_layer_0: s.buildPlateTemperatureInitialLayer,
    material_diameter: machine?.filamentDiameter ?? s.filamentDiameter,
    machine_nozzle_size: machine?.nozzleSize ?? s.nozzleDiameter,
    speed_print: s.printSpeed,
    speed_travel: s.travelSpeed,
    layer_height: s.layerHeight,
    layer_height_0: s.initialLayerHeight,
    machine_name: machine?.name ?? "Custom Gen 3D printer",
    fan_speed: pct255(s.fanSpeed),
  };
  return text.replace(/\{(\w+)\}/g, (whole, token) =>
    token in map ? String(map[token]) : whole,
  );
}

export interface EmitResult {
  gcode: string;
  filamentMm: number;
  estimatedMinutes: number;
}

/**
 * Turn ordered per-layer extrusion paths into G-code, honouring every flavour
 * setting (temps, flow, per-feature speeds, acceleration, jerk, retraction,
 * z-hop, combing threshold, cooling) and — when a machine profile is supplied —
 * its Start/End G-code, origin-at-center offset, G-code flavor, and fan number.
 */
export function emitGcode(layers: SliceLayer[], s: SlicerSettings, machine?: MachineProfile): EmitResult {
  const lines: string[] = [];
  const filamentDia = machine?.filamentDiameter ?? s.filamentDiameter;
  const filamentArea = Math.PI * (filamentDia / 2) ** 2;
  const travelF = s.travelSpeed * 60;
  const retractF = s.retractionSpeed * 60;
  const retractMinTravel = s.combingMode === "off" ? 0.5 : 2.0;

  // Origin-at-center shifts model coords (min at 0) to a centre-origin machine.
  const ox = machine?.originAtCenter ? -(machine.bedWidth ?? 0) / 2 : 0;
  const oy = machine?.originAtCenter ? -(machine.bedDepth ?? 0) / 2 : 0;

  // Fan command honours the machine's cooling fan index.
  const fanNum = machine?.coolingFanNumber ?? 0;
  const fanP = fanNum > 0 ? ` P${fanNum}` : "";
  const fanCmd = (pct: number) => `M106${fanP} S${pct255(pct)}`;
  const flavor = machine?.gcodeFlavor ?? "Marlin";

  let e = 0;
  let retracted = false;
  let filamentMm = 0;
  let totalSeconds = 0;

  // ---- Header --------------------------------------------------------------
  lines.push(`; Gen3D G-code — built-in TypeScript slicer`);
  lines.push(`; Printer: ${machine?.name ?? s.printerPreset ?? "Custom"} · ${s.material}`);
  lines.push(`; Layer height: ${s.layerHeight}mm (initial ${s.initialLayerHeight}mm)`);
  lines.push(`; Walls: ${s.wallLineCount} · Infill: ${s.infillDensity}% ${s.infillPattern}`);
  lines.push(`; Top/Bottom: ${s.topLayers}/${s.bottomLayers} · Support: ${s.generateSupport ? s.supportPattern : "off"}`);
  lines.push(`; Adhesion: ${s.buildPlateAdhesionType}`);
  if (s.avoidPrintedPartsWhenTraveling) lines.push(`; Combing: ${s.combingMode} (avoid printed parts)`);
  lines.push(`;FLAVOR:${flavor}`);
  lines.push("");
  lines.push("G21 ; millimeters");
  lines.push("G90 ; absolute positioning");
  lines.push("M82 ; absolute extrusion");

  if (machine?.startGcode && machine.startGcode.trim()) {
    // User/machine Start G-code replaces the default temp/home block.
    lines.push("; --- machine start G-code ---");
    lines.push(substituteTokens(machine.startGcode, s, machine));
    lines.push("; --- end machine start G-code ---");
  } else {
    lines.push(`M140 S${s.buildPlateTemperatureInitialLayer} ; set bed temp (initial layer)`);
    lines.push(`M104 S${s.printingTemperature} ; set nozzle temp`);
    lines.push(`M190 S${s.buildPlateTemperatureInitialLayer} ; wait for bed`);
    lines.push(`M109 S${s.printingTemperature} ; wait for nozzle`);
    lines.push("G28 ; home all axes");
    lines.push("G92 E0 ; reset extruder");
  }

  if (s.enableAccelerationControl) {
    const t = s.enableTravelAcceleration ? s.travelAcceleration : s.printAcceleration;
    lines.push(`M204 P${s.printAcceleration} T${t} ; acceleration`);
  }
  if (s.enableJerkControl) lines.push(`M205 X${s.printJerk} Y${s.printJerk} ; jerk`);
  // Initial fan state.
  lines.push(s.enablePrintCooling ? `${fanCmd(s.initialFanSpeed)} ; fan (initial)` : "M107 ; fan off");
  lines.push("");

  let cursor: Pt = { x: 0, y: 0 };

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const isFirst = li === 0;
    const flowMul = (isFirst ? s.initialLayerFlow : s.flow) / 100;
    const extrusionArea = s.lineWidth * layer.thickness;

    lines.push(`;LAYER:${li}`);
    lines.push(`; Z=${f(layer.z)}  thickness=${f(layer.thickness)}`);

    // Material/bed temp + fan transitions when leaving the first layer.
    if (li === 1) {
      if (s.buildPlateTemperature !== s.buildPlateTemperatureInitialLayer)
        lines.push(`M140 S${s.buildPlateTemperature} ; bed temp (rest)`);
      if (s.enablePrintCooling) lines.push(`${fanCmd(s.fanSpeed)} ; fan`);
    }

    // Move up to layer Z (with current retract/z-hop already settled).
    lines.push(`G0 Z${f(layer.z)} F${travelF}`);

    // ---- Minimum layer time → per-layer speed scaling --------------------
    let extLen = 0;
    for (const p of layer.paths)
      for (let i = 1; i < p.pts.length; i++) extLen += dist(p.pts[i - 1], p.pts[i]);
    const nominalSpeed = isFirst ? s.initialLayerSpeed : s.printSpeed;
    let speedScale = 1;
    if (s.minimumLayerTime > 0 && extLen > 0) {
      const layerSeconds = extLen / Math.max(1, nominalSpeed);
      if (layerSeconds < s.minimumLayerTime)
        speedScale = Math.max(0.2, layerSeconds / s.minimumLayerTime);
    }

    let curType: FeatureType | null = null;

    for (const path of layer.paths) {
      if (path.pts.length < 2) continue;
      if (path.type !== curType) {
        lines.push(`;TYPE:${TYPE_LABEL[path.type]}`);
        curType = path.type;
      }

      const speed = featureSpeed(path.type, s, isFirst) * speedScale;
      const printF = Math.round(speed * 60);
      const start = path.pts[0];

      // ---- Travel to the path start --------------------------------------
      const travel = dist(cursor, start);
      if (travel > 1e-3) {
        const doRetract = s.enableRetraction && travel >= retractMinTravel;
        if (doRetract && !retracted) {
          e -= s.retractionDistance;
          lines.push(`G1 E${e.toFixed(5)} F${retractF} ; retract`);
          retracted = true;
        }
        if (retracted && s.zHopWhenRetracted) lines.push(`G0 Z${f(layer.z + s.zHopHeight)} F${travelF} ; z-hop`);
        lines.push(`G0 X${f(start.x + ox)} Y${f(start.y + oy)} F${travelF}`);
        if (retracted && s.zHopWhenRetracted) lines.push(`G0 Z${f(layer.z)} F${travelF}`);
        if (retracted) {
          e += s.retractionDistance;
          lines.push(`G1 E${e.toFixed(5)} F${retractF} ; unretract`);
          retracted = false;
        }
        totalSeconds += travel / s.travelSpeed;
      }

      // ---- Extrude along the path ----------------------------------------
      for (let i = 1; i < path.pts.length; i++) {
        const m = path.pts[i];
        const segLen = dist(path.pts[i - 1], m);
        const eInc = (segLen * extrusionArea * flowMul) / filamentArea;
        e += eInc;
        filamentMm += eInc;
        totalSeconds += segLen / Math.max(1, speed);
        lines.push(`G1 X${f(m.x + ox)} Y${f(m.y + oy)} E${e.toFixed(5)} F${printF}`);
      }
      cursor = path.pts[path.pts.length - 1];
    }
  }

  // ---- Footer --------------------------------------------------------------
  lines.push("");
  if (s.enableRetraction) lines.push(`G1 E${(e - s.retractionDistance).toFixed(5)} F${retractF} ; final retract`);
  if (machine?.endGcode && machine.endGcode.trim()) {
    lines.push("; --- machine end G-code ---");
    lines.push(substituteTokens(machine.endGcode, s, machine));
    lines.push("; --- end machine end G-code ---");
  } else {
    lines.push("M104 S0 ; nozzle off");
    lines.push("M140 S0 ; bed off");
    lines.push("M107 ; fan off");
    lines.push("M84 ; disable motors");
  }
  lines.push("; End of print");

  return {
    gcode: lines.join("\n"),
    filamentMm,
    estimatedMinutes: Math.round((totalSeconds / 60) * 10) / 10,
  };
}
