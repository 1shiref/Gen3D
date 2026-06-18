import type { Response } from "express";

export function initSSE(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

export function writeSSE(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function closeSSE(res: Response): void {
  res.write("event: done\ndata: null\n\n");
  res.end();
}

export function errorSSE(res: Response, message: string, code = "UNKNOWN_ERROR"): void {
  res.write(`event: error\ndata: ${JSON.stringify({ message, code })}\n\n`);
  res.end();
}
