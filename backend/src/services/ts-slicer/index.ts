import fs from "fs";
import { parseStl, getStlBounds } from "./stl-parser";
import { sliceAtZ } from "./slicer-engine";
import { orderPaths } from "./path-planner";
import { emitGcode } from "./gcode-emitter";
import {
  stitchLoops, bboxOfLoops, makeGrid, rasterizeRegion, dilateGrid, gridToLoops,
  GridSpec,
} from "./geometry";
import { buildWalls, buildInfill, buildAdhesion, buildSupport, SkinContext } from "./regions";
import type { Loop, SliceLayer, ExtrusionPath } from "./types";
import type { SlicerSettings, MachineProfile } from "../slicer.service";

export interface SliceResult {
  gcodeContent: string;
  layerCount: number;
  estimatedTimeMinutes: number;
  filamentUsageMm: number;
  filamentUsageGrams: number;
}

const MATERIAL_DENSITY: Record<string, number> = {
  PLA: 1.24, PETG: 1.27, ABS: 1.04, TPU: 1.21,
};

export function sliceStl(stlPath: string, settings: SlicerSettings, machine?: MachineProfile): SliceResult {
  const buffer = fs.readFileSync(stlPath);
  const triangles = parseStl(buffer);
  const bounds = getStlBounds(triangles);

  // ---- Layer Z plan (layer 0 uses the initial layer height) ----------------
  const zs: Array<{ z: number; thickness: number }> = [];
  let z = bounds.min.z;
  const total = bounds.max.z - bounds.min.z;
  if (total > 0) {
    // First layer
    const first = Math.min(settings.initialLayerHeight, total);
    zs.push({ z: bounds.min.z + first, thickness: first });
    z = bounds.min.z + first;
    while (z < bounds.max.z - 1e-6) {
      const th = Math.min(settings.layerHeight, bounds.max.z - z);
      z += th;
      zs.push({ z, thickness: th });
    }
  }

  // ---- Cross-sections → oriented loops per layer ---------------------------
  const layerLoops: Loop[][] = zs.map(({ z: top, thickness }) =>
    stitchLoops(sliceAtZ(triangles, top - thickness / 2))
  );

  // ---- Occupancy grids (for top/bottom skin + support) ---------------------
  const modelBBox = bboxOfLoops(layerLoops.flat());
  const grid: GridSpec = makeGrid(modelBBox, settings.lineWidth, settings.lineWidth * 2);
  const occ: Uint8Array[] = layerLoops.map((loops) => rasterizeRegion(loops, grid));

  // ---- Support occupancy (best-effort, top-down propagation) ---------------
  const support = settings.generateSupport
    ? computeSupport(occ, grid, settings)
    : null;

  // ---- Build per-layer extrusion paths -------------------------------------
  const layers: SliceLayer[] = [];
  let cursor = { x: bounds.min.x, y: bounds.min.y };

  for (let i = 0; i < zs.length; i++) {
    const loops = layerLoops[i];
    const ctx: SkinContext = { grids: occ, g: grid, layerIndex: i, total: zs.length };
    const paths: ExtrusionPath[] = [];

    if (loops.length > 0) {
      paths.push(...buildWalls(loops, settings));
      paths.push(...buildInfill(loops, settings, ctx));
    }

    // Support for this layer
    if (support && support.layers[i] && support.layers[i].length > 0) {
      const isInterface = support.interface[i];
      paths.push(...buildSupport(support.layers[i], settings, i, isInterface));
    }

    // First-layer adhesion around the model outline.
    if (i === 0 && loops.length > 0) {
      paths.push(...buildAdhesion(loops, settings));
    }

    const ordered = orderPaths(paths, cursor);
    if (ordered.length > 0) cursor = ordered[ordered.length - 1].pts.slice(-1)[0];
    layers.push({ z: zs[i].z, thickness: zs[i].thickness, paths: ordered });
  }

  // ---- Emit ----------------------------------------------------------------
  const { gcode, filamentMm, estimatedMinutes } = emitGcode(layers, settings, machine);

  const filamentDia = machine?.filamentDiameter ?? settings.filamentDiameter;
  const filamentArea = Math.PI * (filamentDia / 2) ** 2;
  const density = MATERIAL_DENSITY[settings.material] ?? 1.24;
  const filamentGrams = (filamentMm * filamentArea * density) / 1000;

  return {
    gcodeContent: gcode,
    layerCount: zs.length,
    estimatedTimeMinutes: estimatedMinutes,
    filamentUsageMm: Math.round(filamentMm),
    filamentUsageGrams: Math.round(filamentGrams * 10) / 10,
  };
}

/**
 * Best-effort support areas per layer. A cell needs support if the layer above
 * is occupied but the current layer (dilated by the overhang allowance and the
 * XY distance) is not. Support stops `supportZDistance` below the model; the
 * top interface layers are flagged for denser/solid fill.
 */
function computeSupport(occ: Uint8Array[], g: GridSpec, s: SlicerSettings) {
  const n = occ.length;
  const cell = g.res;
  const overhangCells = Math.max(0, Math.round((s.layerHeight * Math.tan((s.supportOverhangAngle * Math.PI) / 180)) / cell));
  const xyCells = Math.max(0, Math.round(s.supportXYDistance / cell));
  const zLayers = Math.max(0, Math.round(s.supportZDistance / s.layerHeight));
  const interfaceLayers = Math.max(0, Math.round(s.supportInterfaceThickness / s.layerHeight));
  const touchingOnly = s.supportPlacement === "touching-buildplate";

  // needSupport[i] = cell occupied above but unsupported by this layer (+overhang/xy margin).
  const need: Uint8Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const out = new Uint8Array(g.w * g.h);
    const above = occ[i + 1];
    if (above) {
      const grown = dilateGrid(occ[i], g, Math.max(overhangCells, xyCells));
      for (let k = 0; k < out.length; k++) if (above[k] && !grown[k]) out[k] = 1;
    }
    need[i] = out;
  }

  // Propagate support columns downward, leaving a z-distance gap under the model.
  const layersMask: Uint8Array[] = new Array(n);
  const interfaceFlag: boolean[] = new Array(n).fill(false);
  let column = new Uint8Array(g.w * g.h);
  for (let i = n - 1; i >= 0; i--) {
    // Add new overhangs detected just above this layer.
    if (i + 1 < n) for (let k = 0; k < column.length; k++) if (need[i + 1][k]) column[k] = 1;
    // Can't place support where the model is, nor within z-distance below it.
    let blocked = occ[i];
    for (let dz = 1; dz <= zLayers && i + dz < n; dz++) {
      const b = occ[i + dz];
      const nb = new Uint8Array(blocked);
      for (let k = 0; k < nb.length; k++) if (b[k]) nb[k] = 1;
      blocked = nb;
    }
    const here = new Uint8Array(g.w * g.h);
    let any = false;
    for (let k = 0; k < here.length; k++) {
      if (column[k] && !blocked[k]) { here[k] = 1; any = true; }
      // A supported column that now hits the model stops descending.
      if (occ[i][k]) column[k] = touchingOnly ? 0 : column[k];
    }
    // Interface = within interfaceLayers below an overhang (model directly above within z+iface).
    if (any) {
      const modelClose = i + zLayers + 1 < n ? occ[Math.min(n - 1, i + zLayers + 1)] : null;
      interfaceFlag[i] = s.enableSupportInterface && !!modelClose && interfaceLayers > 0 &&
        someOverlap(here, modelClose);
    }
    layersMask[i] = here;
  }

  // Convert masks (inflated by support horizontal expansion) to loops.
  const expandCells = Math.max(0, Math.round(s.supportHorizontalExpansion / cell));
  const layers: Loop[][] = layersMask.map((m) => {
    const filled = expandCells > 0 ? dilateGrid(m, g, expandCells) : m;
    const loops = gridToLoops(filled, g);
    // Merge adjacent cell boxes loosely via a tiny outward then inward offset.
    return loops;
  });

  return { layers, interface: interfaceFlag };
}

function someOverlap(a: Uint8Array, b: Uint8Array): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] && b[k]) return true;
  return false;
}
