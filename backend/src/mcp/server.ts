/**
 * Gen3D MCP server — exposes the mesh analyze/slice pipeline as MCP tools so
 * Claude Code (or any MCP client) can inspect and slice 3D models with real print stats.
 *
 * Run via tsx (handles the SDK's ESM exports map):
 *   npx tsx backend/src/mcp/server.ts
 * Registered in the repo's .mcp.json so `claude` picks it up automatically.
 */
import fs from "fs";
import path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config";
import { sliceToGcode, FACTORY_PROFILE, type SlicerSettings } from "../services/slicer.service";
import { getStlBoundingBox, analyzePrintability } from "../services/mesh.service";
import { tempPath } from "../utils/file-helpers";

/** Resolve a user-supplied STL reference (URL/filename/path) to an absolute uploads path. */
function resolveUploadPath(ref: string): string {
  const p = path.join(config.uploadsDir, path.basename(ref));
  if (!fs.existsSync(p)) throw new Error(`File not found in uploads: ${path.basename(ref)}`);
  return p;
}

const TOOLS = [
  {
    name: "analyze_mesh",
    description: "Report bounding box (mm) and FDM printability warnings for an STL in the uploads dir (by filename).",
    inputSchema: {
      type: "object",
      properties: { stlPath: { type: "string", description: "STL filename in the uploads dir." } },
      required: ["stlPath"],
    },
  },
  {
    name: "slice_stl",
    description: "Slice an STL to G-code with the built-in slicer and return print stats (layers, time, filament).",
    inputSchema: {
      type: "object",
      properties: {
        stlPath: { type: "string", description: "STL filename in the uploads dir." },
        layerHeight: { type: "number", description: "mm, default 0.2" },
        infillPercent: { type: "number", description: "default 20" },
        material: { type: "string", description: "PLA | PETG | ABS | TPU, default PLA" },
      },
      required: ["stlPath"],
    },
  },
];

const server = new Server(
  { name: "gen3d", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    switch (name) {
      case "analyze_mesh": {
        const stl = resolveUploadPath(String(args.stlPath ?? ""));
        const bbox = getStlBoundingBox(stl);
        const printability = analyzePrintability(stl);
        return {
          content: [{
            type: "text",
            text: `Bounding box: ${bbox.x.toFixed(1)} × ${bbox.y.toFixed(1)} × ${bbox.z.toFixed(1)} mm\n` +
              `Material suggestion: ${printability.materialSuggestion}\n` +
              `Warnings: ${printability.warnings.length ? "\n - " + printability.warnings.join("\n - ") : "none"}`,
          }],
        };
      }

      case "slice_stl": {
        const stl = resolveUploadPath(String(args.stlPath ?? ""));
        const settings: SlicerSettings = {
          ...FACTORY_PROFILE,
          layerHeight: Number(args.layerHeight ?? FACTORY_PROFILE.layerHeight),
          infillDensity: Number(args.infillPercent ?? FACTORY_PROFILE.infillDensity),
          material: (String(args.material ?? FACTORY_PROFILE.material) as SlicerSettings["material"]),
          printerPreset: "custom",
        };
        const result = await sliceToGcode(stl, settings);
        const gcodePath = tempPath(".gcode");
        fs.writeFileSync(gcodePath, result.gcodeContent, "utf-8");
        return {
          content: [{
            type: "text",
            text: `Sliced → ${path.basename(gcodePath)}\n` +
              `Layers: ${result.layerCount}\n` +
              `Est. time: ${result.estimatedTimeMinutes} min\n` +
              `Filament: ${result.filamentUsageMm.toFixed(0)} mm (${result.filamentUsageGrams.toFixed(1)} g)`,
          }],
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs (stdout is the MCP channel).
  console.error("[gen3d-mcp] ready — tools: analyze_mesh, slice_stl");
}

main().catch((err) => {
  console.error("[gen3d-mcp] fatal:", err);
  process.exit(1);
});
