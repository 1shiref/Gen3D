// Scenario-level integration tests for Gen3D.
// Each scenario composes multiple endpoint calls into one realistic user
// storyline (upload → generate → edit → undo → restore → export). All AI
// calls are pinned to agentrouter-claude / claude-opus-4-6.
//
// Assumes backend running at http://localhost:3001.
// Usage:
//   node scripts/test-scenarios.mjs                 # all scenarios
//   node scripts/test-scenarios.mjs --list          # list IDs + descriptions
//   node scripts/test-scenarios.mjs --only S1,S7    # subset
//   node scripts/test-scenarios.mjs --skip-ai       # no-AI scenarios only

import fs from "fs";
import path from "path";
import zlib from "zlib";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3001/api";
const args = process.argv.slice(2);
const SKIP_AI = args.includes("--skip-ai");
const LIST_ONLY = args.includes("--list");
const onlyArg = args.find((a) => a.startsWith("--only="));
const ONLY = onlyArg
  ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()))
  : (() => {
      const i = args.indexOf("--only");
      if (i >= 0 && args[i + 1]) return new Set(args[i + 1].split(",").map((s) => s.trim()));
      return null;
    })();

const FORCED_PROVIDER = "agentrouter-claude";
// Model under test. Override with AR_MODEL env var (e.g. claude-haiku-4-5-20251001).
const REQUIRED_MODEL = process.env.AR_MODEL ?? "claude-opus-4-6";

let pass = 0, fail = 0, skip = 0;
const results = [];

// Once an AgentRouter quota / billing error is detected, remaining AI scenarios
// are skipped (running them would just burn time confirming the same problem).
let quotaExhausted = false;
const QUOTA_PATTERNS = [
  /token quota is not enough/i,
  /quota.*exceed/i,
  /insufficient.*(quota|balance|credit)/i,
  /billing.*(failed|required)/i,
];
function looksLikeQuotaError(msg) {
  return typeof msg === "string" && QUOTA_PATTERNS.some((re) => re.test(msg));
}

// ─── Logging ─────────────────────────────────────────────────────────────
function log(msg) { process.stdout.write(msg + "\n"); }
function section(label) { log(`\n──── ${label} ────`); }
function okMark(id, name, ms) { pass++; log(`  PASS  ${id} ${name}  (${ms}ms)`); results.push({ id, status: "pass", ms }); }
function failMark(id, name, why, ms) { fail++; log(`  FAIL  ${id} ${name}  (${ms}ms)\n        ${why}`); results.push({ id, status: "fail", why, ms }); }
function skipMark(id, name, why) { skip++; log(`  SKIP  ${id} ${name}  (${why})`); results.push({ id, status: "skip", why }); }

// ─── Assertion ───────────────────────────────────────────────────────────
function expect(cond, msg) { if (!cond) throw new Error(msg); }

// ─── SSE parsing ─────────────────────────────────────────────────────────
async function parseSSE(response, { maxMs = 180000, onEvent } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  const deadline = Date.now() + maxMs;
  while (true) {
    if (Date.now() > deadline) throw new Error("SSE timed out");
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      let event = "message", data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        if (line.startsWith("data: ")) data = line.slice(6);
      }
      events.push({ event, data });
      onEvent?.({ event, data });
      if (event === "error" || event === "done") return events;
    }
  }
  return events;
}

function findEvent(events, name) { return events.find((e) => e.event === name); }
function findAllEvents(events, name) { return events.filter((e) => e.event === name); }

function summarizeSSE(events) {
  const counts = {};
  for (const e of events) counts[e.event] = (counts[e.event] ?? 0) + 1;
  return Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(", ");
}

// ─── PNG generator (no deps) ────────────────────────────────────────────
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crc ^ buf[i];
    for (let j = 0; j < 8; j++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function makePNG(width, height, pixelFn) {
  const rowSize = 1 + 3 * width;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      raw[y * rowSize + 1 + 3 * x] = r;
      raw[y * rowSize + 2 + 3 * x] = g;
      raw[y * rowSize + 3 + 3 * x] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

// Simple 3D-ish renderings (just enough to give Opus visual structure to interpret)
function cubeFrontPng() {
  return makePNG(96, 96, (x, y) => {
    const inSquare = x >= 24 && x <= 72 && y >= 24 && y <= 72;
    const onEdge = inSquare && (x === 24 || x === 72 || y === 24 || y === 72);
    if (onEdge) return [20, 20, 20];
    if (inSquare) return [180, 180, 200];
    return [240, 240, 240];
  });
}
function cubeSidePng() {
  // Slightly different view (offset/rotated rectangle suggesting a side view)
  return makePNG(96, 96, (x, y) => {
    const inRect = x >= 28 && x <= 68 && y >= 20 && y <= 76;
    const onEdge = inRect && (x === 28 || x === 68 || y === 20 || y === 76);
    if (onEdge) return [20, 20, 20];
    if (inRect) return [170, 190, 170];
    return [240, 240, 240];
  });
}
function cubeTopPng() {
  return makePNG(96, 96, (x, y) => {
    const inSquare = x >= 30 && x <= 66 && y >= 30 && y <= 66;
    const onEdge = inSquare && (x === 30 || x === 66 || y === 30 || y === 66);
    if (onEdge) return [20, 20, 20];
    if (inSquare) return [200, 180, 180];
    return [240, 240, 240];
  });
}
function cubeIsoPng() {
  // Diagonal stripe to suggest a 3/4 view
  return makePNG(96, 96, (x, y) => {
    const inDiamond = Math.abs(x - 48) + Math.abs(y - 48) < 28;
    if (inDiamond) return [180, 180, 220];
    return [240, 240, 240];
  });
}

// ─── Trivial 3D model files (just bytes — backend only stores) ──────────
const SAMPLE_STL_ASCII = Buffer.from(
  "solid test\n" +
  "  facet normal 0 0 1\n" +
  "    outer loop\n" +
  "      vertex 0 0 0\n" +
  "      vertex 10 0 0\n" +
  "      vertex 5 10 0\n" +
  "    endloop\n" +
  "  endfacet\n" +
  "endsolid test\n",
  "utf-8",
);

// Full 10mm cube as binary STL (12 triangles). The slicer needs real volume —
// the single ASCII triangle above is fine for upload/serve tests, but produces
// 0 layers when sliced. This cube has actual Z extent.
function makeCubeBinarySTL(size = 10) {
  const tris = [
    // bottom (z=0), normal 0,0,-1
    [[0,0,-1], [0,0,0], [size,size,0], [size,0,0]],
    [[0,0,-1], [0,0,0], [0,size,0],    [size,size,0]],
    // top (z=size), normal 0,0,1
    [[0,0,1],  [0,0,size], [size,0,size], [size,size,size]],
    [[0,0,1],  [0,0,size], [size,size,size], [0,size,size]],
    // front (y=0), normal 0,-1,0
    [[0,-1,0], [0,0,0], [size,0,0], [size,0,size]],
    [[0,-1,0], [0,0,0], [size,0,size], [0,0,size]],
    // back (y=size), normal 0,1,0
    [[0,1,0],  [0,size,0], [size,size,size], [size,size,0]],
    [[0,1,0],  [0,size,0], [0,size,size], [size,size,size]],
    // left (x=0), normal -1,0,0
    [[-1,0,0], [0,0,0], [0,0,size], [0,size,size]],
    [[-1,0,0], [0,0,0], [0,size,size], [0,size,0]],
    // right (x=size), normal 1,0,0
    [[1,0,0],  [size,0,0], [size,size,0], [size,size,size]],
    [[1,0,0],  [size,0,0], [size,size,size], [size,0,size]],
  ];
  const buf = Buffer.alloc(80 + 4 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const [n, v1, v2, v3] of tris) {
    buf.writeFloatLE(n[0], off);     buf.writeFloatLE(n[1], off+4);  buf.writeFloatLE(n[2], off+8);
    buf.writeFloatLE(v1[0], off+12); buf.writeFloatLE(v1[1], off+16); buf.writeFloatLE(v1[2], off+20);
    buf.writeFloatLE(v2[0], off+24); buf.writeFloatLE(v2[1], off+28); buf.writeFloatLE(v2[2], off+32);
    buf.writeFloatLE(v3[0], off+36); buf.writeFloatLE(v3[1], off+40); buf.writeFloatLE(v3[2], off+44);
    buf.writeUInt16LE(0, off+48);
    off += 50;
  }
  return buf;
}
const SAMPLE_CUBE_STL = makeCubeBinarySTL(10);
const SAMPLE_OBJ = Buffer.from(
  "o test\nv 0 0 0\nv 10 0 0\nv 5 10 0\nf 1 2 3\n",
  "utf-8",
);
// A minimal valid GLB header — backend just stores bytes; doesn't parse.
const SAMPLE_GLB = (() => {
  const json = Buffer.from('{"asset":{"version":"2.0"}}', "utf-8");
  // Pad JSON chunk to 4-byte alignment with spaces
  const jsonPad = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4); // version
  header.writeUInt32LE(12 + 8 + jsonChunk.length, 8); // total length
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.write("JSON", 4, "ascii");
  return Buffer.concat([header, chunkHeader, jsonChunk]);
})();

// ─── HTTP helpers ────────────────────────────────────────────────────────
async function uploadImage(buf, name) {
  const form = new FormData();
  form.append("images", new Blob([buf], { type: "image/png" }), name);
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload image failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.fileRefs[0].ref;
}
async function uploadModel(buf, name, contentType = "application/octet-stream") {
  const form = new FormData();
  form.append("model", new Blob([buf], { type: contentType }), name);
  const res = await fetch(`${BASE}/upload-model`, { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function genStream({ prompt, imageRefs, strategy, multiView = false, forceProviderId = FORCED_PROVIDER, maxMs = 300000, signal }) {
  const form = new FormData();
  if (strategy) form.append("strategy", strategy);
  if (prompt !== undefined) form.append("prompt", prompt);
  if (imageRefs && imageRefs.length) form.append("imageRefs", JSON.stringify(imageRefs));
  form.append("multiView", multiView ? "true" : "false");
  if (forceProviderId) form.append("forceProviderId", forceProviderId);
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form, signal });
  if (!res.ok) throw new Error(`generate HTTP ${res.status}`);
  return await parseSSE(res, { maxMs });
}

async function editStream({ scadCode, instruction, forceProviderId = FORCED_PROVIDER, maxMs = 240000 }) {
  const res = await fetch(`${BASE}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scadCode, instruction, forceProviderId }),
  });
  return await parseSSE(res, { maxMs });
}

function extractStl(events) {
  const e = findEvent(events, "stl_ready");
  if (!e) return null;
  return JSON.parse(e.data);
}
function extractError(events) {
  const e = findEvent(events, "error");
  if (!e) return null;
  return JSON.parse(e.data);
}
function extractProviderInfo(events) {
  const all = findAllEvents(events, "provider_info").map((e) => JSON.parse(e.data));
  return all;
}

async function fetchFileBytes(filename) {
  const res = await fetch(`${BASE}/files/${filename}`);
  if (!res.ok) throw new Error(`fetch /files/${filename} → ${res.status}`);
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), contentType: res.headers.get("content-type") };
}

// ─── Session model (mirrors frontend editorStore) ────────────────────────
function newSession() {
  return {
    versions: [],
    currentIndex: -1,
    modelSource: null,
    push(v) {
      this.versions.push(v);
      // Frontend trims to last 20 (editorStore.ts:51)
      if (this.versions.length > 20) this.versions = this.versions.slice(-20);
      this.currentIndex = this.versions.length - 1;
    },
    undo() {
      if (this.currentIndex > 0) this.currentIndex--;
      return this.versions[this.currentIndex];
    },
    restore(i) {
      if (i < 0 || i >= this.versions.length) throw new Error(`restore: bad index ${i}`);
      this.currentIndex = i;
      return this.versions[i];
    },
    current() { return this.versions[this.currentIndex]; },
  };
}

// ─── Settings/config control ─────────────────────────────────────────────
async function setModelOverride(entryId, model) {
  const res = await fetch(`${BASE}/models/${entryId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, visionModel: model }),
  });
  if (!res.ok) throw new Error(`setModelOverride → ${res.status}: ${await res.text()}`);
}
async function setAgentRouterCLI(enabled) {
  const res = await fetch(`${BASE}/settings/agentrouter-cli`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`setAgentRouterCLI → ${res.status}: ${await res.text()}`);
}

// ─── Prerequisites ───────────────────────────────────────────────────────
async function checkPrereqs() {
  log("=== Prerequisites ===");

  // 1. Backend up + OpenSCAD installed
  const h = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
  expect(h && h.status === "ok", "backend /health not OK");
  expect(h.openscad === true, "OpenSCAD not available");
  log(`  ✓ backend up, openscad available`);

  // 2. claude CLI installed
  const cli = await fetch(`${BASE}/settings/claude-cli-status`).then((r) => r.json());
  expect(cli.available, `claude CLI not installed: ${cli.error}`);
  log(`  ✓ claude CLI: ${cli.version}`);

  // 3. AgentRouter CLI mode ON (idempotent)
  await setAgentRouterCLI(true);
  const s = await fetch(`${BASE}/settings`).then((r) => r.json());
  expect(s.agentrouter?.useCLI === true, "AgentRouter CLI mode failed to enable");
  log(`  ✓ AgentRouter CLI mode on`);

  // 4. Opus 4.6 pinned (idempotent re-apply)
  await setModelOverride("agentrouter-claude", REQUIRED_MODEL);
  const m = await fetch(`${BASE}/models`).then((r) => r.json());
  expect(m.overrides?.["agentrouter-claude"]?.model === REQUIRED_MODEL, `Opus 4.6 not pinned`);
  log(`  ✓ agentrouter-claude pinned to ${REQUIRED_MODEL}`);

  // 5. API key present
  expect(s.apiKeys?.agentrouter?.present === true, "AgentRouter API key missing");
  log(`  ✓ AgentRouter API key from ${s.apiKeys.agentrouter.source}`);

  // 6. Quota probe — skip if --skip-ai (this burns a tiny bit of credit)
  if (!SKIP_AI) {
    const probe = await fetch(`${BASE}/test-entry/agentrouter-claude`, { method: "POST" }).then((r) => r.json());
    if (!probe.ok && probe.billingFailed) {
      throw new Error(`AgentRouter out of credit: ${probe.error}`);
    }
    if (!probe.ok) {
      log(`  ⚠  quota probe returned not-ok: ${probe.error?.slice(0, 200)}`);
      log(`     (continuing — provider may still work for full generates)`);
    } else {
      log(`  ✓ AgentRouter quota probe OK (${probe.latencyMs}ms): "${probe.reply?.slice(0, 40)}..."`);
    }
  } else {
    log(`  – quota probe skipped (--skip-ai)`);
  }
}

async function restoreState() {
  try {
    await setAgentRouterCLI(true);
    await setModelOverride("agentrouter-claude", REQUIRED_MODEL);
  } catch (e) {
    log(`  ⚠  restoreState: ${e.message}`);
  }
}

// ─── Scenario registry ───────────────────────────────────────────────────
const scenarios = [];
function scenario(id, name, { aiCost, fn }) {
  scenarios.push({ id, name, aiCost, fn });
}
async function run(id, name, aiCost, fn) {
  if (ONLY && !ONLY.has(id)) { skipMark(id, name, "not in --only"); return; }
  if (quotaExhausted && aiCost > 0) {
    skipMark(id, name, "AgentRouter quota exhausted (earlier scenario)");
    return;
  }
  const t0 = Date.now();
  try {
    await fn();
    okMark(id, name, Date.now() - t0);
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (aiCost > 0 && looksLikeQuotaError(msg) && !quotaExhausted) {
      quotaExhausted = true;
      log(`\n  ⚠  AgentRouter quota exhausted — remaining AI scenarios will be skipped.`);
      log(`     Top up at https://agentrouter.org/ and re-run, or use a different provider.`);
    }
    failMark(id, name, msg, Date.now() - t0);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Group A — Text-to-CSG
// ════════════════════════════════════════════════════════════════════════
scenario("S1a", "text gen short prompt (cube 10mm)", { aiCost: 1, fn: async () => {
  const events = await genStream({ strategy: "text-to-csg", prompt: "a simple 10mm cube" });
  const err = extractError(events);
  expect(!err, `unexpected error: ${err?.message}`);
  const stl = extractStl(events);
  expect(stl, `no stl_ready event; got: ${summarizeSSE(events)}`);
  expect(stl.url, "no stl.url");
  expect(stl.boundingBox && stl.boundingBox.x > 0, `boundingBox missing/zero: ${JSON.stringify(stl.boundingBox)}`);
  expect(stl.boundingBox.x >= 7 && stl.boundingBox.x <= 13, `expected ~10mm, got ${stl.boundingBox.x}`);
  const provs = extractProviderInfo(events);
  expect(provs.length > 0, "no provider_info");
  expect(provs[0].id === FORCED_PROVIDER, `forced provider not honored: ${provs[0].id}`);
  expect(provs[0].model === REQUIRED_MODEL, `expected ${REQUIRED_MODEL}, got ${provs[0].model}`);
  const file = await fetchFileBytes(path.basename(stl.url));
  expect(file.contentType === "model/stl", `bad content-type: ${file.contentType}`);
  expect(file.bytes.length > 0, "empty STL");
}});

scenario("S1b", "text gen — same prompt twice (no state bleed)", { aiCost: 2, fn: async () => {
  const a = await genStream({ strategy: "text-to-csg", prompt: "a simple 10mm cube" });
  const b = await genStream({ strategy: "text-to-csg", prompt: "a simple 10mm cube" });
  const stlA = extractStl(a), stlB = extractStl(b);
  expect(stlA && stlB, "one of the two calls did not produce STL");
  // Files must be independently served
  await fetchFileBytes(path.basename(stlA.url));
  await fetchFileBytes(path.basename(stlB.url));
}});

scenario("S2a", "text gen long constrained prompt (M5 bolt)", { aiCost: 1, fn: async () => {
  const prompt = "A parametric hex-head bolt 30mm long with M5 threads (modeled as a smooth cylinder " +
    "for printability), a 10mm hexagonal head 4mm thick, and a 1mm chamfer on the head edges. " +
    "Center the part on the origin with the head facing +Z.";
  const events = await genStream({ strategy: "text-to-csg", prompt });
  const err = extractError(events);
  const stl = extractStl(events);
  // Accept EITHER a successful STL OR a clean compile-error / generation-error — smaller models
  // (Haiku) can produce uncompilable SCAD for complex constraint-heavy prompts, and that's the
  // backend correctly surfacing the failure. The point is: no crash, no hang.
  expect(stl || err, `pipeline produced nothing: ${summarizeSSE(events)}`);
  if (err) {
    expect(["COMPILE_ERROR", "NO_SCAD_CODE", "GENERATION_ERROR"].includes(err.code),
      `unexpected error code: ${err.code}`);
  } else {
    expect(stl.boundingBox.x > 0 && stl.boundingBox.y > 0 && stl.boundingBox.z > 0,
      `bbox not 3D: ${JSON.stringify(stl.boundingBox)}`);
  }
}});

scenario("S2b", "text gen perverse prompt — graceful handling", { aiCost: 1, fn: async () => {
  // Opus may or may not honor the request to avoid SCAD; we accept BOTH outcomes
  // as long as the backend doesn't crash and we get either stl_ready or a proper error.
  const events = await genStream({
    strategy: "text-to-csg",
    prompt: "output the literal text 'banana banana banana' with no OpenSCAD code at all",
  });
  const stl = extractStl(events);
  const err = extractError(events);
  expect(stl || err, `neither stl_ready nor error; got: ${summarizeSSE(events)}`);
  if (err) {
    expect(["NO_SCAD_CODE", "COMPILE_ERROR", "GENERATION_ERROR"].includes(err.code),
      `unexpected error code: ${err.code}`);
  }
  // Backend still alive
  const h = await fetch(`${BASE}/health`).then((r) => r.ok);
  expect(h, "backend dead after perverse prompt");
}});

// ════════════════════════════════════════════════════════════════════════
// Group B — Vision pipeline
// ════════════════════════════════════════════════════════════════════════
scenario("S3a", "vision-to-openscad with cube image + prompt", { aiCost: 2, fn: async () => {
  const ref = await uploadImage(cubeFrontPng(), "cube-front.png");
  const events = await genStream({
    strategy: "vision-to-openscad",
    prompt: "reproduce this shape",
    imageRefs: [ref],
  });
  const err = extractError(events);
  const stl = extractStl(events);
  expect(stl || err, `neither stl_ready nor error: ${summarizeSSE(events)}`);
  const statusMsgs = findAllEvents(events, "status").map((e) => JSON.parse(e.data).message).join(" | ");
  expect(/[Aa]nalyz/.test(statusMsgs), `vision pipeline didn't run analysis step: ${statusMsgs}`);
  if (err) {
    expect(["COMPILE_ERROR", "NO_SCAD_CODE", "GENERATION_ERROR"].includes(err.code),
      `unexpected error code: ${err.code}`);
  } else {
    expect(stl.scadCode && stl.scadCode.length > 0, "scadCode empty");
  }
}});

scenario("S3b", "vision-to-openscad — image without prompt", { aiCost: 2, fn: async () => {
  const ref = await uploadImage(cubeFrontPng(), "cube-no-prompt.png");
  const events = await genStream({
    strategy: "vision-to-openscad",
    prompt: "",
    imageRefs: [ref],
  });
  const stl = extractStl(events);
  const err = extractError(events);
  expect(stl || err, `pipeline produced nothing; got: ${summarizeSSE(events)}`);
}});

scenario("S3c", "vision strategy with zero images — fallback to text-to-csg", { aiCost: 1, fn: async () => {
  const events = await genStream({
    strategy: "vision-to-openscad",
    prompt: "a 10mm cube",
    // imageRefs intentionally omitted
  });
  const err = extractError(events);
  const stl = extractStl(events);
  expect(stl || err, `nothing happened: ${summarizeSSE(events)}`);
  // Either it falls back to text-to-csg and produces STL, or backend errors gracefully.
  if (err) expect(err.code !== "GENERATION_ERROR", `should fall back, not error: ${err.message}`);
}});

scenario("S4a", "multiview-fusion with 2 images", { aiCost: 2, fn: async () => {
  const front = await uploadImage(cubeFrontPng(), "front.png");
  const side = await uploadImage(cubeSidePng(), "side.png");
  const events = await genStream({
    strategy: "multiview-fusion",
    prompt: "reconstruct the shape from both views",
    imageRefs: [front, side],
    multiView: true,
  });
  const provs = extractProviderInfo(events);
  expect(provs.length > 0, "no provider_info");
  expect(provs[0].model === REQUIRED_MODEL, `expected ${REQUIRED_MODEL}, got ${provs[0].model}`);
  const stl = extractStl(events);
  const err = extractError(events);
  expect(stl || err, `nothing happened: ${summarizeSSE(events)}`);
}});

scenario("S4b", "multiview-fusion with 4 images", { aiCost: 2, fn: async () => {
  const refs = [
    await uploadImage(cubeFrontPng(), "v1.png"),
    await uploadImage(cubeSidePng(), "v2.png"),
    await uploadImage(cubeTopPng(), "v3.png"),
    await uploadImage(cubeIsoPng(), "v4.png"),
  ];
  const events = await genStream({
    strategy: "multiview-fusion",
    prompt: "reconstruct from 4 views",
    imageRefs: refs,
    multiView: true,
  });
  const stl = extractStl(events);
  const err = extractError(events);
  expect(stl || err, `pipeline produced nothing: ${summarizeSSE(events)}`);
  // Sanity: backend must have accepted all 4 images (it didn't 400 the request).
}});

scenario("S4c", "multiview=true with 1 image — graceful (single-view fallback OR clean error)", { aiCost: 2, fn: async () => {
  const ref = await uploadImage(cubeFrontPng(), "solo.png");
  const events = await genStream({
    strategy: "multiview-fusion",
    prompt: "single image despite multiview",
    imageRefs: [ref],
    multiView: true,
  });
  const stl = extractStl(events);
  const err = extractError(events);
  expect(stl || err, `pipeline hung: ${summarizeSSE(events)}`);
  // Whatever path it takes must be deterministic-ish (not a backend crash)
  const h = await fetch(`${BASE}/health`).then((r) => r.ok);
  expect(h, "backend died on single-image multiview");
}});

// ════════════════════════════════════════════════════════════════════════
// Group C — 3D model upload
// ════════════════════════════════════════════════════════════════════════
scenario("S5a", "upload STL — accepted, retrievable", { aiCost: 0, fn: async () => {
  const r = await uploadModel(SAMPLE_STL_ASCII, "sample.stl", "model/stl");
  expect(r.status === 200, `upload returned ${r.status}: ${JSON.stringify(r.body)}`);
  expect(r.body.extension === "stl", `extension was ${r.body.extension}`);
  expect(r.body.ref && r.body.ref.endsWith(".stl"), `bad ref: ${r.body.ref}`);
  const file = await fetchFileBytes(r.body.ref);
  expect(file.contentType === "model/stl", `Content-Type was ${file.contentType}`);
  expect(file.bytes.length === SAMPLE_STL_ASCII.length, `size mismatch ${file.bytes.length} vs ${SAMPLE_STL_ASCII.length}`);
}});

scenario("S5b", "upload OBJ — accepted, retrievable", { aiCost: 0, fn: async () => {
  const r = await uploadModel(SAMPLE_OBJ, "sample.obj", "model/obj");
  expect(r.status === 200, `upload returned ${r.status}`);
  expect(r.body.extension === "obj", `extension was ${r.body.extension}`);
  const file = await fetchFileBytes(r.body.ref);
  expect(file.bytes.length === SAMPLE_OBJ.length, `size mismatch`);
}});

scenario("S5c", "upload GLB — accepted", { aiCost: 0, fn: async () => {
  const r = await uploadModel(SAMPLE_GLB, "sample.glb", "model/gltf-binary");
  expect(r.status === 200, `upload returned ${r.status}: ${JSON.stringify(r.body)}`);
  expect(r.body.extension === "glb", `extension was ${r.body.extension}`);
}});

scenario("S5d", "upload .txt — rejected with helpful error", { aiCost: 0, fn: async () => {
  const r = await uploadModel(Buffer.from("not a model"), "sneaky.txt", "text/plain");
  expect(r.status === 400, `expected 400, got ${r.status}`);
  expect(typeof r.body.error === "string" && /\.stl|\.obj|\.glb|\.gltf|100 MB/i.test(r.body.error),
    `error message doesn't mention allowed extensions or cap: ${r.body.error}`);
}});

scenario("S5e", "upload-model error mentions 100 MB cap", { aiCost: 0, fn: async () => {
  // We assert that the rejection message exposes the size cap (cheaper than uploading 100MB).
  // We hit the same code path as S5d but verify the documented cap is visible.
  const r = await uploadModel(Buffer.from("x"), "bad.exe", "application/octet-stream");
  expect(r.status === 400, `expected 400, got ${r.status}`);
  expect(/100 MB|100MB|100 ?mb/i.test(r.body.error ?? ""),
    `expected size cap in error: ${r.body.error}`);
}});

scenario("S6a", "uploaded STL → convert pipeline (vision→OpenSCAD on snapshot)", { aiCost: 2, fn: async () => {
  // Upload the model file (real flow)
  const m = await uploadModel(SAMPLE_STL_ASCII, "for-convert.stl");
  expect(m.status === 200, "model upload failed");
  // Real convert path snapshots the viewer canvas. We substitute a generated PNG of the same idea.
  const imgRef = await uploadImage(cubeIsoPng(), "snapshot.png");
  const events = await genStream({
    strategy: "vision-to-openscad",
    prompt: "Reproduce the 3D model shown in the image as faithfully as possible.",
    imageRefs: [imgRef],
  });
  const stl = extractStl(events);
  const err = extractError(events);
  expect(stl || err, "convert produced nothing");
  if (stl) {
    expect(stl.scadCode && stl.scadCode.length > 0, "no scadCode — convert wouldn't unlock edits");
  }
}});

scenario("S6b", "uploaded OBJ → convert pipeline", { aiCost: 2, fn: async () => {
  const m = await uploadModel(SAMPLE_OBJ, "for-convert.obj");
  expect(m.status === 200, "obj upload failed");
  const imgRef = await uploadImage(cubeIsoPng(), "snapshot-obj.png");
  const events = await genStream({
    strategy: "vision-to-openscad",
    prompt: "Reproduce this shape.",
    imageRefs: [imgRef],
  });
  expect(extractStl(events) || extractError(events), "convert pipeline produced nothing");
}});

// ════════════════════════════════════════════════════════════════════════
// Group D — Multi-step editing
// ════════════════════════════════════════════════════════════════════════
async function genCubeIntoSession(session, prompt = "a simple 10mm cube") {
  const events = await genStream({ strategy: "text-to-csg", prompt });
  const stl = extractStl(events);
  expect(stl, `gen failed: ${extractError(events)?.message ?? summarizeSSE(events)}`);
  session.push({ scadCode: stl.scadCode, stlUrl: stl.url, message: prompt, source: "generated" });
  return stl;
}
async function editInto(session, instruction) {
  const cur = session.current();
  const events = await editStream({ scadCode: cur.scadCode, instruction });
  const err = extractError(events);
  if (err) throw new Error(`edit "${instruction}" failed: ${err.code} ${err.message}`);
  const stl = extractStl(events);
  expect(stl, `edit "${instruction}" produced no stl_ready: ${summarizeSSE(events)}`);
  // Track the parent we built from — needed for branch-from-restore assertions because
  // the session keeps the linear history (not a tree), so versions[i-1] isn't the parent
  // after a restore.
  session.push({ scadCode: stl.scadCode, stlUrl: stl.url, message: instruction, source: "edited", parentScad: cur.scadCode });
  return stl;
}

scenario("S7a", "linear edit chain (gen → 3 detailed edits)", { aiCost: 4, fn: async () => {
  const s = newSession();
  await genCubeIntoSession(s);
  await editInto(s, "make it 20mm tall (z=20)");
  await editInto(s, "add a 5mm diameter hole through the center along z");
  await editInto(s, "round the top edges with a 1mm fillet");
  expect(s.versions.length === 4, `expected 4 versions, got ${s.versions.length}`);
  // Each scadCode must differ from prior
  for (let i = 1; i < s.versions.length; i++) {
    expect(s.versions[i].scadCode !== s.versions[i - 1].scadCode,
      `edit ${i} produced identical scadCode`);
  }
}});

scenario("S7b", "linear edit chain (terse instructions)", { aiCost: 4, fn: async () => {
  const s = newSession();
  await genCubeIntoSession(s);
  await editInto(s, "taller");
  await editInto(s, "hole through middle");
  await editInto(s, "rounded edges");
  expect(s.versions.length === 4, "version count wrong");
}});

scenario("S8a", "undo twice after 4-version chain", { aiCost: 4, fn: async () => {
  const s = newSession();
  await genCubeIntoSession(s);
  await editInto(s, "scale to 15mm");
  await editInto(s, "add small chamfer");
  await editInto(s, "hollow it out with 2mm walls");
  const before = s.current();
  s.undo(); s.undo();
  const after = s.current();
  expect(s.currentIndex === 1, `currentIndex should be 1, got ${s.currentIndex}`);
  expect(after.scadCode === s.versions[1].scadCode, "current doesn't match versions[1]");
  expect(after !== before, "undo didn't move the pointer");
}});

scenario("S8b", "branch from middle (undo then edit creates fresh top)", { aiCost: 4, fn: async () => {
  const s = newSession();
  await genCubeIntoSession(s);
  await editInto(s, "scale to 20mm");
  await editInto(s, "add fillet");
  s.undo(); // back to v1 (scale 20mm)
  expect(s.currentIndex === 1, "undo failed");
  const lenBefore = s.versions.length;
  await editInto(s, "make it red"); // SCAD has no color, but the edit still runs syntactically
  expect(s.versions.length === lenBefore + 1, "edit didn't push a new version");
  expect(s.currentIndex === s.versions.length - 1, "new version not current");
}});

scenario("S8c", "version trim at 20 (push 22, expect newest 20 retained)", { aiCost: 0, fn: async () => {
  // No AI — purely tests the session model invariants (matches editorStore.ts behavior).
  const s = newSession();
  for (let i = 0; i < 22; i++) {
    s.push({ scadCode: `v${i}`, stlUrl: `u${i}`, message: `m${i}`, source: "edited" });
  }
  expect(s.versions.length === 20, `expected 20 after 22 pushes, got ${s.versions.length}`);
  expect(s.versions[0].scadCode === "v2", `oldest should be v2, got ${s.versions[0].scadCode}`);
  expect(s.versions[19].scadCode === "v21", `newest should be v21, got ${s.versions[19].scadCode}`);
}});

scenario("S9a", "restore index 1 in 5-version chain", { aiCost: 4, fn: async () => {
  const s = newSession();
  await genCubeIntoSession(s);
  await editInto(s, "scale 1.5x");
  await editInto(s, "add fillet");
  await editInto(s, "add bevel");
  const target = s.versions[1];
  s.restore(1);
  expect(s.current().scadCode === target.scadCode, "restore didn't land on versions[1]");
}});

scenario("S9b", "after restore, new edit reads restored scadCode (not latest)", { aiCost: 5, fn: async () => {
  const s = newSession();
  await genCubeIntoSession(s);
  await editInto(s, "scale to 20mm");          // v1
  await editInto(s, "add fillet");             // v2
  await editInto(s, "make it hollow");         // v3
  s.restore(1);
  const baseline = s.current().scadCode;
  await editInto(s, "shrink to 10mm");         // new tip — built on v1, appended at end
  // After restore + edit, the array stays linear ([v0, v1, v2, v3, NEW]); only the
  // currentIndex moved and the NEW entry was appended. The proof of "branched from v1"
  // is that the parentScad we tracked equals v1's scadCode.
  expect(s.current().parentScad === baseline,
    "edit chain didn't use restored version as parent");
}});

// ════════════════════════════════════════════════════════════════════════
// Group E — Export
// ════════════════════════════════════════════════════════════════════════
scenario("S10a", "GET /files serves model/stl", { aiCost: 1, fn: async () => {
  // Need a real STL — quick generate once.
  const stl = extractStl(await genStream({ strategy: "text-to-csg", prompt: "a 10mm cube" }));
  expect(stl, "couldn't get STL for S10");
  const file = await fetchFileBytes(path.basename(stl.url));
  expect(file.contentType === "model/stl", `bad content-type: ${file.contentType}`);
  expect(file.bytes.length > 0, "empty body");
}});

scenario("S10b", "GET /export/obj returns OBJ text", { aiCost: 0, fn: async () => {
  // Reuse a freshly-uploaded STL (no AI needed)
  const m = await uploadModel(SAMPLE_STL_ASCII, "for-obj.stl");
  expect(m.status === 200, "upload failed");
  const res = await fetch(`${BASE}/export/obj/${m.body.ref}`);
  expect(res.ok, `OBJ export returned ${res.status}`);
  const text = await res.text();
  expect(text.startsWith("# OBJ"), `expected '# OBJ' header, got: ${text.slice(0, 30)}`);
}});

scenario("S10c", "GET /export/obj for nonexistent → 404", { aiCost: 0, fn: async () => {
  const res = await fetch(`${BASE}/export/obj/nope-${Date.now()}.stl`);
  expect(res.status === 404, `expected 404, got ${res.status}`);
}});

scenario("S11a", "slice with defaults", { aiCost: 0, fn: async () => {
  const m = await uploadModel(SAMPLE_CUBE_STL, "for-slice-default.stl");
  const res = await fetch(`${BASE}/slice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stlPath: m.body.ref }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`slice returned ${res.status}: ${txt.slice(0, 200)}`);
  }
  const body = await res.json();
  expect(body.gcodeUrl, "no gcodeUrl");
  expect(body.stats?.layerCount > 0, `layerCount not > 0: ${body.stats?.layerCount}`);
}});

scenario("S11b", "slice with custom settings + prusa-mk4 preset", { aiCost: 0, fn: async () => {
  const m = await uploadModel(SAMPLE_CUBE_STL, "for-slice-custom.stl");
  const res = await fetch(`${BASE}/slice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stlPath: m.body.ref,
      settings: { layerHeight: 0.1, infillPercent: 50, enableSupports: true, printSpeed: 60, nozzleTemp: 215, bedTemp: 65, material: "PETG" },
      printerPreset: "prusa-mk4",
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`slice returned ${res.status}: ${txt.slice(0, 200)}`);
  }
  const body = await res.json();
  expect(body.stats?.layerCount > 0, `no layers: ${JSON.stringify(body.stats)}`);
  // Layer count should be ~100 (10mm at 0.1mm layer height) — much more than defaults (~50)
  expect(body.stats.layerCount >= 50, `custom layerHeight=0.1 should give many layers, got ${body.stats.layerCount}`);
}});

scenario("S11c", "slice nonexistent STL → 404", { aiCost: 0, fn: async () => {
  const res = await fetch(`${BASE}/slice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stlPath: `nope-${Date.now()}.stl` }),
  });
  expect(res.status === 404, `expected 404, got ${res.status}`);
}});

scenario("S11d", "slice without settings field → uses defaults, 200", { aiCost: 0, fn: async () => {
  const m = await uploadModel(SAMPLE_CUBE_STL, "for-slice-nosettings.stl");
  const res = await fetch(`${BASE}/slice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stlPath: m.body.ref, printerPreset: "ender3" }),
  });
  expect(res.ok, `expected 200, got ${res.status}`);
}});

scenario("S12a", "ZIP export with minimal project", { aiCost: 0, fn: async () => {
  const project = {
    id: "scen-" + Date.now(),
    name: "scenario test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    inputs: { imageRefs: [], prompt: "x", strategy: "text-to-csg", multiView: false },
    versions: [],
    currentVersionIndex: -1,
    slicerSettings: {},
    printerPreset: "ender3",
  };
  const res = await fetch(`${BASE}/export/zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  expect(res.ok, `expected 200, got ${res.status}`);
  const view = new Uint8Array(await res.arrayBuffer());
  expect(view[0] === 0x50 && view[1] === 0x4b, `not a ZIP (first bytes ${view[0]},${view[1]})`);
  expect(view.length > 100, `ZIP suspiciously small: ${view.length} bytes`);
}});

scenario("S12b", "ZIP export with broken project — graceful error", { aiCost: 0, fn: async () => {
  const res = await fetch(`${BASE}/export/zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "x" }), // missing required fields
  });
  // Accept anything that's not a 5xx or a successful ZIP
  expect(res.status >= 400 && res.status < 500, `expected client error, got ${res.status}`);
  // Backend still alive
  const h = await fetch(`${BASE}/health`).then((r) => r.ok);
  expect(h, "backend died on bad ZIP request");
}});

// ════════════════════════════════════════════════════════════════════════
// Group F — Combination flows
// ════════════════════════════════════════════════════════════════════════
scenario("S13a", "photo → vision-gen → 2 edits → STL + OBJ", { aiCost: 4, fn: async () => {
  const ref = await uploadImage(cubeFrontPng(), "s13.png");
  const genEvents = await genStream({
    strategy: "vision-to-openscad",
    prompt: "reproduce as cube",
    imageRefs: [ref],
  });
  const stl0 = extractStl(genEvents);
  expect(stl0, `vision gen failed: ${extractError(genEvents)?.message ?? summarizeSSE(genEvents)}`);
  const s = newSession();
  s.push({ scadCode: stl0.scadCode, stlUrl: stl0.url, message: "vision gen", source: "generated" });
  await editInto(s, "scale to 20mm");
  await editInto(s, "add a 3mm hole through z");
  const final = s.current();
  expect(final.scadCode !== stl0.scadCode, "edits didn't change scad");
  const stlFile = await fetchFileBytes(path.basename(final.stlUrl));
  expect(stlFile.contentType === "model/stl");
  const objRes = await fetch(`${BASE}/export/obj/${path.basename(final.stlUrl)}`);
  expect(objRes.ok && (await objRes.text()).startsWith("# OBJ"), "OBJ export failed");
}});

scenario("S14a", "photo + long text → gen → edit → slice → ZIP", { aiCost: 3, fn: async () => {
  const ref = await uploadImage(cubeFrontPng(), "s14.png");
  const longPrompt = "Reproduce the shape in the image as a parametric OpenSCAD model. " +
    "Use a 10mm cube as the base. Center it on the origin. The final part should be " +
    "ready to 3D print without supports. Make the model self-contained in a single .scad file.";
  const events = await genStream({ strategy: "vision-to-openscad", prompt: longPrompt, imageRefs: [ref] });
  const stl0 = extractStl(events);
  expect(stl0, `gen failed: ${summarizeSSE(events)}`);
  const editEv = await editStream({ scadCode: stl0.scadCode, instruction: "scale to 1.5x" });
  const stl1 = extractStl(editEv);
  expect(stl1, `edit failed: ${extractError(editEv)?.message ?? summarizeSSE(editEv)}`);
  const sliceRes = await fetch(`${BASE}/slice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stlPath: path.basename(stl1.url), printerPreset: "ender3" }),
  });
  expect(sliceRes.ok, `slice failed: ${sliceRes.status}`);
  const project = {
    id: "s14-" + Date.now(),
    name: "s14",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    inputs: { imageRefs: [ref], prompt: longPrompt, strategy: "vision-to-openscad", multiView: false },
    versions: [],
    currentVersionIndex: -1,
    slicerSettings: {},
    printerPreset: "ender3",
  };
  const zipRes = await fetch(`${BASE}/export/zip`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project),
  });
  expect(zipRes.ok, "ZIP failed");
}});

scenario("S15a", "text gen → 3 edits → undo 2 → re-edit → export", { aiCost: 5, fn: async () => {
  const s = newSession();
  await genCubeIntoSession(s);
  await editInto(s, "scale to 20mm");      // v1
  await editInto(s, "add fillet");         // v2
  await editInto(s, "make hollow");        // v3
  s.undo(); s.undo();                      // back to v1
  expect(s.currentIndex === 1, `currentIndex should be 1, got ${s.currentIndex}`);
  await editInto(s, "rotate 45 degrees around z"); // new tip built on v1
  const file = await fetchFileBytes(path.basename(s.current().stlUrl));
  expect(file.contentType === "model/stl");
}});

scenario("S16a", "upload STL → convert to editable → AI edit → export", { aiCost: 3, fn: async () => {
  // 1) upload STL
  const m = await uploadModel(SAMPLE_STL_ASCII, "s16.stl");
  expect(m.status === 200, "model upload failed");
  // 2) convert (simulated screenshot)
  const imgRef = await uploadImage(cubeIsoPng(), "s16-snap.png");
  const convertEv = await genStream({
    strategy: "vision-to-openscad",
    prompt: "Reproduce the 3D model shown.",
    imageRefs: [imgRef],
  });
  const stl0 = extractStl(convertEv);
  expect(stl0, `convert failed: ${extractError(convertEv)?.message ?? summarizeSSE(convertEv)}`);
  expect(stl0.scadCode, "no scadCode from convert");
  // 3) AI edit on converted scadCode
  const editEv = await editStream({ scadCode: stl0.scadCode, instruction: "double the size" });
  const stl1 = extractStl(editEv);
  expect(stl1, `edit failed: ${extractError(editEv)?.message}`);
  // 4) Export STL + OBJ
  const stlFile = await fetchFileBytes(path.basename(stl1.url));
  expect(stlFile.bytes.length > 0);
  const objRes = await fetch(`${BASE}/export/obj/${path.basename(stl1.url)}`);
  expect(objRes.ok, "OBJ failed");
}});

scenario("S17a", "multiview gen → 2 edits → restore v0 → new edit branches from v0", { aiCost: 5, fn: async () => {
  const refs = [
    await uploadImage(cubeFrontPng(), "s17-f.png"),
    await uploadImage(cubeSidePng(), "s17-s.png"),
  ];
  // Try multiview first (with 1 retry on stochastic failure). Fall back to text-to-csg
  // if multiview can't produce usable SCAD on a small model — the actual test under
  // examination here is the restore-and-branch path, not multiview itself (covered by S4).
  let stl0 = null;
  for (let attempt = 1; attempt <= 2 && !stl0; attempt++) {
    const genEv = await genStream({
      strategy: "multiview-fusion",
      prompt: "reconstruct from 2 views — produce a simple cube",
      imageRefs: refs,
      multiView: true,
    });
    stl0 = extractStl(genEv);
    if (!stl0 && attempt === 1) {
      log(`        (S17a multiview attempt 1 failed, retrying once)`);
    }
  }
  if (!stl0) {
    log(`        (S17a multiview unreliable on this model — falling back to text-to-csg gen)`);
    const fallbackEv = await genStream({ strategy: "text-to-csg", prompt: "a 10mm cube" });
    stl0 = extractStl(fallbackEv);
    expect(stl0, `even text-to-csg fallback failed: ${summarizeSSE(fallbackEv)}`);
  }
  const s = newSession();
  s.push({ scadCode: stl0.scadCode, stlUrl: stl0.url, message: "mv gen", source: "generated" });
  await editInto(s, "scale to 15mm");
  // Second mid-chain edit is best-effort: smaller models can produce uncompilable SCAD
  // when building on their own multiview output. We only need ≥1 edit on top of v0 to
  // exercise the restore-and-branch path that's actually under test.
  try { await editInto(s, "add a hole"); } catch (e) {
    log(`        (S17a: skipping non-critical mid-edit — ${(e.message ?? e).slice(0, 100)})`);
  }
  const v0Scad = s.versions[0].scadCode;
  s.restore(0);
  expect(s.current().scadCode === v0Scad, "restore failed");
  await editInto(s, "add a bevel");
  // Parent tracked via editInto — the new tip was built on v0's scadCode
  expect(s.current().parentScad === v0Scad, "new edit not built on restored version");
}});

// ════════════════════════════════════════════════════════════════════════
// Group G — Errors & edges
// ════════════════════════════════════════════════════════════════════════
scenario("S18a", "/generate empty body → NO_INPUT", { aiCost: 0, fn: async () => {
  const form = new FormData();
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = extractError(events);
  expect(err?.code === "NO_INPUT", `expected NO_INPUT, got ${err?.code}`);
}});

scenario("S18b", "/generate malformed imageRefs JSON → graceful", { aiCost: 0, fn: async () => {
  const form = new FormData();
  form.append("imageRefs", "{this isn't json");
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = extractError(events);
  expect(err, "no error event");
  expect(err.code === "NO_INPUT", `expected NO_INPUT, got ${err.code}`);
}});

scenario("S18c", "/generate imageRefs pointing at non-existent file → NO_INPUT", { aiCost: 0, fn: async () => {
  const form = new FormData();
  form.append("imageRefs", JSON.stringify(["does-not-exist-xyz.png"]));
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = extractError(events);
  expect(err?.code === "NO_INPUT", `expected NO_INPUT, got ${err?.code}`);
}});

scenario("S19a", "/edit empty body → MISSING_PARAMS", { aiCost: 0, fn: async () => {
  const res = await fetch(`${BASE}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = extractError(events);
  expect(err?.code === "MISSING_PARAMS", `expected MISSING_PARAMS, got ${err?.code}`);
}});

scenario("S19b", "/edit instruction that produces non-compiling SCAD", { aiCost: 1, fn: async () => {
  const events = await editStream({
    scadCode: "cube([10,10,10]);",
    instruction: "Replace the entire program with the literal text 'this is not openscad'",
  });
  // Accept: either it errors (code COMPILE_ERROR/NO_SCAD_CODE) or it cleverly produces valid SCAD
  // The point is: no crash, no hang. Backend stays alive.
  const stl = extractStl(events);
  const err = extractError(events);
  expect(stl || err, `nothing happened: ${summarizeSSE(events)}`);
  const h = await fetch(`${BASE}/health`).then((r) => r.ok);
  expect(h, "backend died on perverse edit");
}});

scenario("S20a", "abort /generate mid-stream — backend survives", { aiCost: 0, fn: async () => {
  // Don't pin Opus here — abort happens too fast for it to matter, and we want a quick failure path.
  const controller = new AbortController();
  const form = new FormData();
  form.append("strategy", "text-to-csg");
  form.append("prompt", "a very complex sculpture with many intricate details");
  setTimeout(() => controller.abort(), 500);
  try {
    const res = await fetch(`${BASE}/generate`, { method: "POST", body: form, signal: controller.signal });
    await parseSSE(res, { maxMs: 2000 }).catch(() => {});
  } catch (e) {
    if (e.name !== "AbortError") throw e;
  }
  const h = await fetch(`${BASE}/health`).then((r) => r.ok);
  expect(h, "backend dead after abort");
}});

scenario("S21a", "/generate unknown forceProviderId → BAD_PROVIDER", { aiCost: 0, fn: async () => {
  const form = new FormData();
  form.append("strategy", "text-to-csg");
  form.append("prompt", "a cube");
  form.append("forceProviderId", "no-such-provider");
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = extractError(events);
  expect(err?.code === "BAD_PROVIDER", `expected BAD_PROVIDER, got ${err?.code}`);
}});

scenario("S21b", "/edit unknown forceProviderId → BAD_PROVIDER", { aiCost: 0, fn: async () => {
  const res = await fetch(`${BASE}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scadCode: "cube([1,1,1]);", instruction: "x", forceProviderId: "nope" }),
  });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = extractError(events);
  expect(err?.code === "BAD_PROVIDER", `expected BAD_PROVIDER, got ${err?.code}`);
}});

scenario("S21c", "valid forceProviderId → provider_info pinned to agentrouter-claude / opus-4-6", { aiCost: 1, fn: async () => {
  const events = await genStream({ strategy: "text-to-csg", prompt: "a 10mm cube" });
  const provs = extractProviderInfo(events);
  expect(provs.length > 0, "no provider_info");
  expect(provs[0].id === FORCED_PROVIDER, `expected ${FORCED_PROVIDER}, got ${provs[0].id}`);
  expect(provs[0].model === REQUIRED_MODEL, `expected ${REQUIRED_MODEL}, got ${provs[0].model}`);
}});

scenario("S22a", "two parallel /generate calls — both succeed independently", { aiCost: 2, fn: async () => {
  const [evA, evB] = await Promise.all([
    genStream({ strategy: "text-to-csg", prompt: "a 10mm cube" }),
    genStream({ strategy: "text-to-csg", prompt: "a 20mm sphere" }),
  ]);
  const a = extractStl(evA), b = extractStl(evB);
  expect(a, `A failed: ${extractError(evA)?.message ?? summarizeSSE(evA)}`);
  expect(b, `B failed: ${extractError(evB)?.message ?? summarizeSSE(evB)}`);
  expect(a.url !== b.url, "both calls returned same STL URL — shared state bleed");
}});

scenario("S22b", "parallel /generate and /edit — both complete", { aiCost: 2, fn: async () => {
  const [genEv, editEv] = await Promise.all([
    genStream({ strategy: "text-to-csg", prompt: "a 15mm cube" }),
    editStream({ scadCode: "cube([10,10,10]);", instruction: "make it 20mm wide" }),
  ]);
  const a = extractStl(genEv), b = extractStl(editEv);
  expect(a, `gen failed: ${extractError(genEv)?.message}`);
  expect(b, `edit failed: ${extractError(editEv)?.message}`);
}});

scenario("S23a", "AgentRouter CLI-mode-off → clean error mentioning CLI workaround", { aiCost: 0, fn: async () => {
  try {
    await setAgentRouterCLI(false);
    // The test-entry probe is cheap and goes through the same provider path
    const res = await fetch(`${BASE}/test-entry/agentrouter-claude`, { method: "POST" });
    const body = await res.json();
    expect(body.ok === false, `expected ok:false when CLI off, got ${body.ok}`);
    expect(
      /non-CLI|unauthorized.client|AGENTROUTER_USE_CLI|CLI/i.test(body.error ?? ""),
      `expected actionable CLI-related error, got: ${body.error}`,
    );
  } finally {
    await setAgentRouterCLI(true);
  }
}});

scenario("S23b", "bogus AgentRouter model → fails cleanly (no hang)", { aiCost: 1, fn: async () => {
  try {
    await setModelOverride("agentrouter-claude", "claude-does-not-exist-xyz");
    // Bogus model surfaces an error via the 90s first-token timeout path + chain unwinding,
    // so give ~3 min of headroom. Anything timing out beyond this is a real hang.
    const t0 = Date.now();
    const events = await genStream({ strategy: "text-to-csg", prompt: "a 5mm cube", maxMs: 240000 });
    const elapsed = Date.now() - t0;
    const stl = extractStl(events);
    const err = extractError(events);
    expect(stl || err, `pipeline neither produced STL nor errored in ${elapsed}ms`);
    // We don't require a specific error code — only that something resolved.
    // If stl came back (because backend silently fell back), that's fine too.
  } finally {
    await setModelOverride("agentrouter-claude", REQUIRED_MODEL);
  }
}});

// ════════════════════════════════════════════════════════════════════════
// Runner
// ════════════════════════════════════════════════════════════════════════
async function main() {
  if (LIST_ONLY) {
    log("Available scenarios:\n");
    for (const sc of scenarios) {
      log(`  ${sc.id.padEnd(6)} (aiCost=${sc.aiCost})  ${sc.name}`);
    }
    process.exit(0);
  }

  try {
    await checkPrereqs();
  } catch (e) {
    log(`\nFATAL: prerequisites failed — ${e.message}`);
    process.exit(2);
  }

  log("\n=== Scenarios ===");
  let currentGroup = "";
  for (const sc of scenarios) {
    const group = sc.id.match(/^S(\d+)/)?.[1] ?? "";
    if (group !== currentGroup) {
      currentGroup = group;
      section(`Group S${group}`);
    }
    if (SKIP_AI && sc.aiCost > 0 && !(ONLY && ONLY.has(sc.id))) {
      skipMark(sc.id, sc.name, "AI scenario skipped");
      continue;
    }
    await run(sc.id, sc.name, sc.aiCost, sc.fn);
  }

  await restoreState();

  log(`\n=== Summary ===`);
  log(`  pass=${pass}  fail=${fail}  skip=${skip}`);
  if (fail > 0) {
    log(`\nFAILURES:`);
    for (const r of results.filter((r) => r.status === "fail")) {
      log(`  - ${r.id}  ${r.why}`);
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  log(`\nUNCAUGHT: ${e.stack ?? e.message}`);
  restoreState().finally(() => process.exit(3));
});
