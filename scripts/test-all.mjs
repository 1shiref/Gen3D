// Comprehensive integration test for Gen3D backend.
// Assumes backend is running at http://localhost:3001.
// Usage: node scripts/test-all.mjs [--no-ai]
//   --no-ai : skip tests that consume AI credits

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3001/api";
const SKIP_AI = process.argv.includes("--no-ai");

let pass = 0, fail = 0, skip = 0;
const failures = [];

function log(msg) { process.stdout.write(msg + "\n"); }

function ok(name) { pass++; log(`  PASS  ${name}`); }
function bad(name, why) { fail++; failures.push({ name, why }); log(`  FAIL  ${name}\n        ${why}`); }
function skipped(name, why) { skip++; log(`  SKIP  ${name}  (${why})`); }

async function test(name, fn, { retries = 0 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fn();
      if (attempt > 0) log(`        (retry ${attempt} succeeded)`);
      ok(name);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        log(`        (attempt ${attempt + 1} failed: ${e?.message ?? e} — retrying)`);
      }
    }
  }
  bad(name, lastErr?.message ?? String(lastErr));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function parseSSE(response, { maxMs = 120000, onEvent } = {}) {
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

// ─── 1×1 PNG (transparent) bytes ────────────────────────────────
const tinyPngB64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const tinyPngBytes = Buffer.from(tinyPngB64, "base64");

// ─── Tests ──────────────────────────────────────────────────────

log("\n=== A: Health & System ===");

let healthChain = [];
await test("A1: GET /health returns ai.chain", async () => {
  const res = await fetch(`${BASE}/health`);
  assert(res.ok, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(Array.isArray(body.ai?.chain), "ai.chain missing");
  assert(body.ai.chain.length > 0, "ai.chain empty");
  healthChain = body.ai.chain;
});
await test("A2: /health reports openscad available", async () => {
  const res = await fetch(`${BASE}/health`);
  const body = await res.json();
  assert(body.openscad === true, `openscad should be true, got ${body.openscad}`);
});

log("\n=== B: Upload ===");

let uploadedRef = null;
await test("B1: POST /upload with no files → error", async () => {
  const form = new FormData();
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  assert(!res.ok || res.status >= 400, `expected error, got ${res.status}`);
});

await test("B2: POST /upload single image → 200 with ref", async () => {
  const form = new FormData();
  form.append("images", new Blob([tinyPngBytes], { type: "image/png" }), "test.png");
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  assert(res.ok, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(Array.isArray(body.fileRefs) && body.fileRefs.length === 1,
    "fileRefs missing");
  uploadedRef = body.fileRefs[0].ref;
  assert(typeof uploadedRef === "string" && uploadedRef.length > 0, "ref missing");
});

await test("B3: POST /upload three images → 200 with three refs", async () => {
  const form = new FormData();
  for (let i = 0; i < 3; i++) {
    form.append("images", new Blob([tinyPngBytes], { type: "image/png" }), `t${i}.png`);
  }
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  assert(res.ok, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(body.fileRefs?.length === 3, `expected 3 refs, got ${body.fileRefs?.length}`);
});

log("\n=== C: Generate validation ===");

await test("C1: empty body → SSE error NO_INPUT", async () => {
  const form = new FormData();
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
  assert(res.ok, `expected SSE-200, got ${res.status}`);
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = events.find(e => e.event === "error");
  assert(err, "no error event");
  const data = JSON.parse(err.data);
  assert(data.code === "NO_INPUT", `expected NO_INPUT, got ${data.code}`);
});

await test("C2: imageRefs malformed JSON, no prompt → graceful error", async () => {
  const form = new FormData();
  form.append("imageRefs", "{not json}");
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
  assert(res.ok, `expected SSE-200, got ${res.status}`);
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = events.find(e => e.event === "error");
  assert(err, "no error event"); // should be NO_INPUT (malformed JSON ignored)
  const data = JSON.parse(err.data);
  assert(data.code === "NO_INPUT", `expected NO_INPUT, got ${data.code}`);
});

await test("C3: imageRefs to non-existent file, no prompt → graceful error", async () => {
  const form = new FormData();
  form.append("imageRefs", JSON.stringify(["does-not-exist.png"]));
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = events.find(e => e.event === "error");
  assert(err, "no error event");
  const data = JSON.parse(err.data);
  assert(data.code === "NO_INPUT", `expected NO_INPUT, got ${data.code}`);
});

log("\n=== D: Generate text-only (full AI roundtrip) ===");

let textOnlyStlUrl = null;
let textOnlyStlBasename = null;
if (SKIP_AI) {
  skipped("D1: text-only generation", "AI tests skipped");
} else {
  await test("D1: text-only generation → stl_ready", async () => {
    const form = new FormData();
    form.append("strategy", "text-to-csg");
    form.append("prompt", "a simple 10mm cube");
    form.append("multiView", "false");
    const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
    assert(res.ok, `expected SSE-200, got ${res.status}`);
    const events = await parseSSE(res, { maxMs: 180000 });
    const errors = events.filter(e => e.event === "error");
    if (errors.length) {
      const data = JSON.parse(errors[0].data);
      throw new Error(`backend error: ${data.message}`);
    }
    const stlEvent = events.find(e => e.event === "stl_ready");
    assert(stlEvent, "no stl_ready event");
    const payload = JSON.parse(stlEvent.data);
    assert(payload.url, "no STL url");
    assert(payload.boundingBox, "no boundingBox");
    assert(payload.boundingBox.x > 0, `boundingBox.x should be >0, got ${payload.boundingBox.x}`);
    textOnlyStlUrl = payload.url;
    textOnlyStlBasename = path.basename(payload.url);

    const statusEvents = events.filter(e => e.event === "status");
    assert(statusEvents.length > 0, "no status events received");

    const tokenCount = events.filter(e => e.event === "token").length;
    assert(tokenCount > 0, "no tokens streamed");
  }, { retries: 1 });
}

log("\n=== E: Generate vision pipeline ===");

if (SKIP_AI) {
  skipped("E1: vision pipeline", "AI tests skipped");
} else if (!uploadedRef) {
  skipped("E1: vision pipeline", "no uploaded image from B2");
} else {
  await test("E1: vision-to-openscad with image → SSE flow well-formed", async () => {
    // Note: test image is a 1x1 transparent PNG (intentionally degenerate),
    // so the free model may produce broken SCAD that can't be repaired in 5 attempts.
    // We accept either: (a) stl_ready (model recovers), or (b) a graceful COMPILE_ERROR
    // after the fix loop, or (c) NO_SCAD_CODE. The test verifies the pipeline TRIES.
    const form = new FormData();
    form.append("strategy", "vision-to-openscad");
    form.append("prompt", "recreate the object in the image");
    form.append("imageRefs", JSON.stringify([uploadedRef]));
    form.append("multiView", "false");
    const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
    const events = await parseSSE(res, { maxMs: 540000 });

    const stlEvent = events.find(e => e.event === "stl_ready");
    const errEvent = events.find(e => e.event === "error");
    assert(stlEvent || errEvent, "neither stl_ready nor error received");

    // status messages should mention analysis step (vision pipeline began)
    const statusMsgs = events.filter(e => e.event === "status").map(e => JSON.parse(e.data).message).join(" | ");
    assert(/[Aa]nalyz/.test(statusMsgs), `no analyze status, got: ${statusMsgs}`);

    // provider_info must fire so the user sees which provider analyzed the image
    const providerEvents = events.filter(e => e.event === "provider_info");
    assert(providerEvents.length > 0, "no provider_info events fired");

    if (errEvent) {
      const code = JSON.parse(errEvent.data).code;
      assert(["COMPILE_ERROR", "NO_SCAD_CODE", "GENERATION_ERROR"].includes(code),
        `unexpected error code ${code} for degenerate test image`);
      log(`        (accepted graceful failure: ${code} — known issue with 1×1 test PNG)`);
    }
  });
}

log("\n=== F: Abort ===");

await test("F1: abort mid-stream does not crash backend", async () => {
  const controller = new AbortController();
  const form = new FormData();
  form.append("strategy", "text-to-csg");
  form.append("prompt", "a complex tree with many branches and leaves");
  setTimeout(() => controller.abort(), 500);
  try {
    const res = await fetch(`${BASE}/generate`, { method: "POST", body: form, signal: controller.signal });
    await parseSSE(res, { maxMs: 2000 }).catch(() => {});
  } catch (e) {
    // expected: aborted
    if (e.name !== "AbortError") throw e;
  }
  // confirm backend is still alive
  const h = await fetch(`${BASE}/health`);
  assert(h.ok, "backend died after abort");
});

log("\n=== G: Edit ===");

await test("G1: empty body → MISSING_PARAMS", async () => {
  const res = await fetch(`${BASE}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = events.find(e => e.event === "error");
  assert(err, "no error event");
  const data = JSON.parse(err.data);
  assert(data.code === "MISSING_PARAMS", `expected MISSING_PARAMS, got ${data.code}`);
});

if (SKIP_AI) {
  skipped("G2: valid edit", "AI tests skipped");
} else {
  await test("G2: valid edit → stl_ready", async () => {
    const scadCode = "cube([10, 10, 10]);";
    const res = await fetch(`${BASE}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scadCode, instruction: "make it 20mm wide" }),
    });
    const events = await parseSSE(res, { maxMs: 180000 });
    const errors = events.filter(e => e.event === "error");
    if (errors.length) {
      throw new Error(`backend error: ${JSON.parse(errors[0].data).message}`);
    }
    const stl = events.find(e => e.event === "stl_ready");
    assert(stl, "no stl_ready event");
  }, { retries: 1 });
}

log("\n=== H: Slice ===");

await test("H1: empty body → 400", async () => {
  const res = await fetch(`${BASE}/slice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(res.status === 400, `expected 400, got ${res.status}`);
});

await test("H2: non-existent STL → 404", async () => {
  const res = await fetch(`${BASE}/slice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stlPath: "nonexistent.stl", settings: {} }),
  });
  assert(res.status === 404, `expected 404, got ${res.status}`);
});

if (textOnlyStlBasename) {
  await test("H3: valid STL + settings → 200 with gcode", async () => {
    const res = await fetch(`${BASE}/slice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stlPath: textOnlyStlBasename,
        settings: {
          layerHeight: 0.2,
          infillPercent: 20,
          enableSupports: false,
          printSpeed: 50,
          nozzleTemp: 200,
          bedTemp: 60,
          material: "PLA",
        },
        printerPreset: "ender3",
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`got ${res.status}: ${body.slice(0, 200)}`);
    }
    const body = await res.json();
    assert(body.gcodeUrl, "no gcodeUrl");
    assert(typeof body.stats?.layerCount === "number", "layerCount missing");
  });

  await test("H4: missing settings field → 200 with defaults", async () => {
    const res = await fetch(`${BASE}/slice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stlPath: textOnlyStlBasename, printerPreset: "ender3" }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`got ${res.status}: ${body.slice(0, 200)}`);
    }
  });
} else {
  skipped("H3: slice valid STL", "no STL available (D1 skipped/failed)");
  skipped("H4: slice missing settings", "no STL available");
}

log("\n=== I: Export / Files ===");

await test("I1: GET /files/nonexistent.stl → 404", async () => {
  const res = await fetch(`${BASE}/files/nonexistent-xyz.stl`);
  assert(res.status === 404, `expected 404, got ${res.status}`);
});

if (textOnlyStlBasename) {
  await test("I2: GET /files/<valid stl> → 200 model/stl", async () => {
    const res = await fetch(`${BASE}/files/${textOnlyStlBasename}`);
    assert(res.ok, `expected 200, got ${res.status}`);
    assert(res.headers.get("content-type") === "model/stl",
      `expected model/stl, got ${res.headers.get("content-type")}`);
    const buf = await res.arrayBuffer();
    assert(buf.byteLength > 0, "empty body");
  });

  await test("I4: GET /export/obj/<valid stl> → 200 OBJ text", async () => {
    const res = await fetch(`${BASE}/export/obj/${textOnlyStlBasename}`);
    assert(res.ok, `expected 200, got ${res.status}`);
    const text = await res.text();
    assert(text.startsWith("# OBJ"), `expected '# OBJ' start, got: ${text.slice(0, 30)}`);
  });
} else {
  skipped("I2: serve STL", "no STL available");
  skipped("I4: serve OBJ", "no STL available");
}

await test("I3: GET /export/obj/nonexistent → 404", async () => {
  const res = await fetch(`${BASE}/export/obj/nope.stl`);
  assert(res.status === 404, `expected 404, got ${res.status}`);
});

await test("I5: POST /export/zip with project → 200 ZIP", async () => {
  const project = {
    id: "test-" + Date.now(),
    name: "test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    inputs: { imageRefs: [], prompt: "test", strategy: "text-to-csg", multiView: false },
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
  assert(res.ok, `expected 200, got ${res.status}`);
  const buf = await res.arrayBuffer();
  // ZIP magic = 50 4B 03 04
  const view = new Uint8Array(buf);
  assert(view[0] === 0x50 && view[1] === 0x4B, `not a ZIP file (first bytes: ${view[0]}, ${view[1]})`);
});

log("\n=== M: Model picker (registry + overrides) ===");

await test("M1: GET /models returns registry + overrides + chain", async () => {
  const res = await fetch(`${BASE}/models`);
  assert(res.ok, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(body.registry && typeof body.registry === "object", "no registry");
  assert(body.registry["agentrouter-claude"], "agentrouter-claude missing from registry");
  assert(Array.isArray(body.registry["agentrouter-claude"].text), "no text models");
  assert(Array.isArray(body.registry["agentrouter-claude"].vision), "no vision models");
  assert(body.overrides && typeof body.overrides === "object", "no overrides object");
  assert(Array.isArray(body.chain) && body.chain.length > 0, "no chain");
});

await test("M2: POST override → health reflects new model → clear restores", async () => {
  // Pick a Claude entry that's in the chain (try several common ids)
  const r1 = await fetch(`${BASE}/models`);
  const m1 = await r1.json();
  const target = m1.chain.find(c => c.id === "agentrouter-claude" || c.id === "anthropic" || c.id === "openrouter-claude");
  assert(target, "no Claude entry in chain to test against");

  // Capture original model
  const originalModel = target.model;
  const newModel = originalModel === "claude-opus-4-7" ? "claude-haiku-4-5-20251001" : "claude-opus-4-7";

  // Set override
  const r2 = await fetch(`${BASE}/models/${target.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: newModel, visionModel: newModel }),
  });
  assert(r2.ok, `POST override failed: ${r2.status}`);
  const m2 = await r2.json();
  assert(m2.overrides[target.id]?.model === newModel, `override not applied: ${JSON.stringify(m2.overrides)}`);

  // /health should reflect it
  const r3 = await fetch(`${BASE}/health`);
  const h = await r3.json();
  const entry = h.ai.chain.find(c => c.id === target.id);
  assert(entry.model === newModel, `health shows old model ${entry.model}, expected ${newModel}`);

  // Clear override
  const r4 = await fetch(`${BASE}/models/${target.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: null, visionModel: null }),
  });
  assert(r4.ok, "clear failed");
  const m4 = await r4.json();
  assert(!m4.overrides[target.id], "override not cleared");

  // /health should be back to original
  const r5 = await fetch(`${BASE}/health`);
  const h2 = await r5.json();
  const entry2 = h2.ai.chain.find(c => c.id === target.id);
  assert(entry2.model === originalModel, `expected revert to ${originalModel}, got ${entry2.model}`);
});

await test("M3: POST to unknown entry id → 404", async () => {
  const res = await fetch(`${BASE}/models/totally-fake-id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "foo" }),
  });
  assert(res.status === 404, `expected 404, got ${res.status}`);
});

await test("M4: POST with non-object body → 400", async () => {
  const res = await fetch(`${BASE}/models/agentrouter-claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "[]",
  });
  assert(res.status === 400, `expected 400, got ${res.status}`);
});

log("\n=== N: Billing recheck (per-entry test endpoint) ===");

await test("N1: POST /test-entry/<unknown> → 404", async () => {
  const res = await fetch(`${BASE}/test-entry/no-such-provider`, { method: "POST" });
  assert(res.status === 404, `expected 404, got ${res.status}`);
});

if (SKIP_AI) {
  skipped("N2: per-entry recheck", "AI tests skipped");
} else {
  await test("N2: POST /test-entry/<known> returns ok+billingFailed", async () => {
    const r1 = await fetch(`${BASE}/health`);
    const h = await r1.json();
    const target = h.ai.chain[0];
    assert(target, "no chain entries");

    const r2 = await fetch(`${BASE}/test-entry/${encodeURIComponent(target.id)}`, { method: "POST" });
    assert(r2.status === 200 || r2.status === 502, `unexpected status ${r2.status}`);
    const body = await r2.json();
    assert(body.id === target.id, `wrong id in response: ${body.id}`);
    assert(typeof body.ok === "boolean", "ok missing");
    assert(typeof body.billingFailed === "boolean", "billingFailed missing");
    assert(typeof body.latencyMs === "number", "latencyMs missing");

    // If the entry was previously billing-failed and the test succeeded,
    // the auto-clear should have removed it from /health's billingFailed list.
    if (body.ok) {
      const r3 = await fetch(`${BASE}/health`);
      const h2 = await r3.json();
      assert(!h2.ai.billingFailed.includes(target.id),
        `expected ${target.id} cleared from billingFailed after successful test`);
    }
  });
}

// N3 runs even with --no-ai: AgentRouter's "unauthorized client" response is
// returned by the gateway in <1s and burns no AI credits.
await test("N3: AgentRouter without CLI mode → clear actionable error", async () => {
  const r = await fetch(`${BASE}/health`);
  const h = await r.json();
  const hasAgentRouter = h.ai.chain.some((c) => c.id === "agentrouter-claude");
  if (!hasAgentRouter) {
    skipped("N3", "AgentRouter not configured in chain");
    return;
  }
  if (h.ai.chain.find((c) => c.id === "agentrouter-claude").label.includes("(CLI)")) {
    skipped("N3", "AGENTROUTER_USE_CLI=true — CLI path active, can't test Track A failure");
    return;
  }
  const res = await fetch(`${BASE}/test-entry/agentrouter-claude`, { method: "POST" });
  const body = await res.json();
  assert(body.ok === false, `expected ok:false, got ${body.ok}`);
  assert(
    /non-CLI|unauthorized.client|AGENTROUTER_USE_CLI/i.test(body.error ?? ""),
    `expected actionable error mentioning CLI workaround, got: ${body.error}`,
  );
});

log("\n=== O: Force provider ===");

await test("O1: generate with unknown forceProviderId → BAD_PROVIDER", async () => {
  const form = new FormData();
  form.append("strategy", "text-to-csg");
  form.append("prompt", "a 10mm cube");
  form.append("forceProviderId", "no-such-provider");
  const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = events.find(e => e.event === "error");
  assert(err, "no error event");
  const data = JSON.parse(err.data);
  assert(data.code === "BAD_PROVIDER", `expected BAD_PROVIDER, got ${data.code}`);
});

await test("O2: edit with unknown forceProviderId → BAD_PROVIDER", async () => {
  const res = await fetch(`${BASE}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scadCode: "cube([10,10,10]);",
      instruction: "make it bigger",
      forceProviderId: "no-such-provider",
    }),
  });
  const events = await parseSSE(res, { maxMs: 5000 });
  const err = events.find(e => e.event === "error");
  assert(err, "no error event");
  const data = JSON.parse(err.data);
  assert(data.code === "BAD_PROVIDER", `expected BAD_PROVIDER, got ${data.code}`);
});

if (SKIP_AI) {
  skipped("O3: forced provider end-to-end", "AI tests skipped");
} else {
  await test("O3: generate with forceProviderId pins provider_info", async () => {
    // Pick a ready (non-billing-failed) entry to force.
    const r1 = await fetch(`${BASE}/health`);
    const h = await r1.json();
    const target = h.ai.chain.find(c => c.status === "ready");
    assert(target, "no ready entry in chain to force");

    const form = new FormData();
    form.append("strategy", "text-to-csg");
    form.append("prompt", "a 10mm cube");
    form.append("forceProviderId", target.id);
    const res = await fetch(`${BASE}/generate`, { method: "POST", body: form });
    const events = await parseSSE(res, { maxMs: 180000 });

    const providerEvents = events.filter(e => e.event === "provider_info").map(e => JSON.parse(e.data));
    assert(providerEvents.length > 0, "no provider_info events");
    // The forced entry should be the first one that actually answered
    // (chain may still fall back if it fails, but at minimum it must be tried first).
    assert(providerEvents[0].id === target.id,
      `forced provider not first: expected ${target.id}, got ${providerEvents[0].id}`);
  }, { retries: 1 });
}

log("\n=== Summary ===");
log(`  pass=${pass}  fail=${fail}  skip=${skip}`);
if (fail > 0) {
  log("\nFAILURES:");
  for (const f of failures) log(`  - ${f.name}\n      ${f.why}`);
}
process.exit(fail > 0 ? 1 : 0);
