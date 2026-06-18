// Generates the binary test fixtures (PNGs, STLs, OBJ) used for manual UI
// testing. Run from any cwd:  node gen3d/test-assets/generate-fixtures.mjs
//
// Adapted from helpers in scripts/test-scenarios.mjs so this folder is fully
// self-contained (you can copy it elsewhere).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));

// ─── PNG generator (no deps) ──────────────────────────────────────────────
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

// Unambiguously-3D fixtures: faces are drawn as parallelograms with distinct
// shading per face so the vision model reads them as a 3D solid, not a 2D
// outline. Edges are darkened for crisp face boundaries.

const BG = [240, 240, 240];

// Shade triples (top brightest → right darkest)
const SHADE_TOP    = [205, 213, 225];
const SHADE_LEFT   = [148, 163, 184];
const SHADE_RIGHT  = [100, 116, 139];
const EDGE         = [20, 20, 30];

// Point-in-convex-quad test via 4 cross-products with consistent sign.
// q is [[x,y]*4] in CW or CCW order. Returns true if (px,py) lies inside.
function inQuad(px, py, q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
// True if (px,py) lies within `band` pixels of the quad's perimeter.
function nearQuadEdge(px, py, q, band = 1.4) {
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const ex = ax + dx * t, ey = ay + dy * t;
    const d2 = (px - ex) ** 2 + (py - ey) ** 2;
    if (d2 <= band * band) return true;
  }
  return false;
}

// Isometric cube — three visible faces in three shades, on a 128×128 canvas.
const cubeIsoPng = () => {
  // Vertices of a cube projected with a 30° isometric-ish projection.
  // Centred at (64, 70). Half-size s for screen extent.
  const cx = 64, cy = 70, s = 30;
  const dx = s, dy = Math.round(s * 0.55);
  // 8 corners of the cube in screen space:
  //   front-top-left, front-top-right, front-bot-right, front-bot-left,
  //   back-top-left,  back-top-right,  back-bot-right,  back-bot-left
  const ftl = [cx - dx, cy - dy];
  const ftr = [cx,       cy];
  const fbr = [cx,       cy + 2 * dy];
  const fbl = [cx - dx,  cy + dy + dy];
  const btl = [cx,       cy - 2 * dy];
  const btr = [cx + dx,  cy - dy];
  const bbr = [cx + dx,  cy + dy];
  // Top face: ftl, btl, btr, ftr (CCW)
  const topQuad   = [ftl, btl, btr, ftr];
  // Left face (the user's "front-left"): ftl, ftr, fbr, fbl
  const leftQuad  = [ftl, ftr, fbr, fbl];
  // Right face: ftr, btr, bbr, fbr
  const rightQuad = [ftr, btr, bbr, fbr];

  return makePNG(128, 128, (x, y) => {
    // Edge pass first — darken silhouette and inner edges.
    if (nearQuadEdge(x, y, topQuad)   ||
        nearQuadEdge(x, y, leftQuad)  ||
        nearQuadEdge(x, y, rightQuad)) return EDGE;
    if (inQuad(x, y, topQuad))   return SHADE_TOP;
    if (inQuad(x, y, leftQuad))  return SHADE_LEFT;
    if (inQuad(x, y, rightQuad)) return SHADE_RIGHT;
    return BG;
  });
};

// Front face with a drop shadow — signals "this is a face of a 3D object",
// not just a flat 2D shape on paper.
const cubeFrontPng = () => makePNG(128, 128, (x, y) => {
  const inFace   = x >= 32 && x <= 96 && y >= 28 && y <= 92;
  const onEdge   = inFace && (x === 32 || x === 96 || y === 28 || y === 92);
  // Shadow is the face offset down-right by 8px, only where not occluded.
  const inShadow = x >= 40 && x <= 104 && y >= 36 && y <= 100 && !inFace;
  if (onEdge) return EDGE;
  if (inFace) return SHADE_LEFT;
  if (inShadow) return [205, 210, 215]; // soft grey shadow
  return BG;
});

// Side face with the same drop-shadow trick — taller-than-wide to suggest
// the side profile.
const cubeSidePng = () => makePNG(128, 128, (x, y) => {
  const inFace   = x >= 40 && x <= 88 && y >= 20 && y <= 100;
  const onEdge   = inFace && (x === 40 || x === 88 || y === 20 || y === 100);
  const inShadow = x >= 48 && x <= 96 && y >= 28 && y <= 108 && !inFace;
  if (onEdge) return EDGE;
  if (inFace) return SHADE_RIGHT;
  if (inShadow) return [205, 210, 215];
  return BG;
});

// ─── Binary STL (cube with real volume) ───────────────────────────────────
function makeCubeBinarySTL(size = 20) {
  const tris = [
    [[0,0,-1], [0,0,0], [size,size,0], [size,0,0]],
    [[0,0,-1], [0,0,0], [0,size,0],    [size,size,0]],
    [[0,0,1],  [0,0,size], [size,0,size], [size,size,size]],
    [[0,0,1],  [0,0,size], [size,size,size], [0,size,size]],
    [[0,-1,0], [0,0,0], [size,0,0], [size,0,size]],
    [[0,-1,0], [0,0,0], [size,0,size], [0,0,size]],
    [[0,1,0],  [0,size,0], [size,size,size], [size,size,0]],
    [[0,1,0],  [0,size,0], [0,size,size], [size,size,size]],
    [[-1,0,0], [0,0,0], [0,0,size], [0,size,size]],
    [[-1,0,0], [0,0,0], [0,size,size], [0,size,0]],
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

// ─── ASCII STL (simple pyramid — 4 triangles) ─────────────────────────────
const PYRAMID_ASCII_STL =
`solid pyramid
  facet normal 0 0 -1
    outer loop
      vertex 0 0 0
      vertex 20 0 0
      vertex 10 17 0
    endloop
  endfacet
  facet normal 0 -1 0.5
    outer loop
      vertex 0 0 0
      vertex 20 0 0
      vertex 10 8 15
    endloop
  endfacet
  facet normal 1 1 0.5
    outer loop
      vertex 20 0 0
      vertex 10 17 0
      vertex 10 8 15
    endloop
  endfacet
  facet normal -1 1 0.5
    outer loop
      vertex 10 17 0
      vertex 0 0 0
      vertex 10 8 15
    endloop
  endfacet
endsolid pyramid
`;

// ─── Minimal OBJ (one triangle) ───────────────────────────────────────────
const TRIANGLE_OBJ =
`o triangle
v 0 0 0
v 20 0 0
v 10 17 0
f 1 2 3
`;

// ─── Write everything ─────────────────────────────────────────────────────
function write(name, data) {
  const p = path.join(OUT_DIR, name);
  fs.writeFileSync(p, data);
  const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
  console.log(`  wrote ${name}  (${size} bytes)`);
}

console.log(`Generating test fixtures into ${OUT_DIR}`);
write("cube-front.png",     cubeFrontPng());
write("cube-side.png",      cubeSidePng());
write("cube-iso.png",       cubeIsoPng());
write("cube-20mm.stl",      makeCubeBinarySTL(20));
write("pyramid-ascii.stl",  PYRAMID_ASCII_STL);
write("triangle.obj",       TRIANGLE_OBJ);
console.log("Done.");
