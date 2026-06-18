export interface Vec3 { x: number; y: number; z: number }
export interface Triangle { v0: Vec3; v1: Vec3; v2: Vec3; normal: Vec3 }

export function parseStl(buffer: Buffer): Triangle[] {
  // Detect ASCII vs binary: binary starts with 80-byte header, then uint32 triangle count
  const isBinary = !buffer.slice(0, 5).toString("ascii").startsWith("solid") ||
    // Some binary files start with "solid", check file size
    (buffer.length >= 84 && buffer.readUInt32LE(80) * 50 + 84 === buffer.length);

  return isBinary ? parseBinaryStl(buffer) : parseAsciiStl(buffer.toString("utf-8"));
}

function parseBinaryStl(buf: Buffer): Triangle[] {
  const count = buf.readUInt32LE(80);
  const tris: Triangle[] = [];
  let offset = 84;

  for (let i = 0; i < count; i++) {
    const normal = readVec3(buf, offset); offset += 12;
    const v0 = readVec3(buf, offset); offset += 12;
    const v1 = readVec3(buf, offset); offset += 12;
    const v2 = readVec3(buf, offset); offset += 12;
    offset += 2; // attribute byte count
    tris.push({ normal, v0, v1, v2 });
  }

  return tris;
}

function readVec3(buf: Buffer, offset: number): Vec3 {
  return {
    x: buf.readFloatLE(offset),
    y: buf.readFloatLE(offset + 4),
    z: buf.readFloatLE(offset + 8),
  };
}

function parseAsciiStl(text: string): Triangle[] {
  const tris: Triangle[] = [];
  const facetRegex = /facet normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+outer loop\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;

  let match: RegExpExecArray | null;
  while ((match = facetRegex.exec(text)) !== null) {
    tris.push({
      normal: { x: +match[1], y: +match[2], z: +match[3] },
      v0: { x: +match[4], y: +match[5], z: +match[6] },
      v1: { x: +match[7], y: +match[8], z: +match[9] },
      v2: { x: +match[10], y: +match[11], z: +match[12] },
    });
  }

  return tris;
}

export function getStlBounds(tris: Triangle[]): { min: Vec3; max: Vec3 } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const t of tris) {
    for (const v of [t.v0, t.v1, t.v2]) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
      if (v.z > maxZ) maxZ = v.z;
    }
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}
