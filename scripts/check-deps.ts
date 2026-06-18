import { execSync } from "child_process";

function check(label: string, cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "pipe" });
    console.log(`  ✓ ${label}`);
    return true;
  } catch {
    console.log(`  ✗ ${label} — NOT FOUND`);
    return false;
  }
}

console.log("\nGen3D — Dependency Check\n");

const hasCura = check("CuraEngine CLI", "CuraEngine --version");
const hasPrusa = check("PrusaSlicer CLI", "prusa-slicer --version");
const hasNode = check("Node.js ≥ 18", "node --version");

console.log("");

if (!hasCura && !hasPrusa) {
  console.log("No slicer CLI found — TypeScript fallback slicer will be used.");
  console.log("For better results: install CuraEngine or PrusaSlicer CLI.");
  console.log("");
}

if (!hasNode) {
  console.log("Node.js 18+ required: https://nodejs.org");
}

const slicerStatus = hasCura ? "CuraEngine" : hasPrusa ? "PrusaSlicer" : "TypeScript fallback";
console.log(`Slicer: ${slicerStatus}`);
console.log("3D generation: neural image-to-3D (configure FAL_KEY / REPLICATE_API_TOKEN / HF_TOKEN)");
console.log("");
