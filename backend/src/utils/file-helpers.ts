import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";

export function ensureUploadsDir(): void {
  if (!fs.existsSync(config.uploadsDir)) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
  }
}

export function tempPath(ext: string): string {
  return path.join(config.uploadsDir, `${uuidv4()}${ext}`);
}

export function safeUnlink(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

export function fileUrl(filename: string): string {
  return `/api/files/${path.basename(filename)}`;
}

export function readFileBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString("base64");
}

export function getMediaType(filePath: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return map[ext] ?? "image/jpeg";
}
