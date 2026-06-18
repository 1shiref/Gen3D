import type { Request, Response, NextFunction } from "express";
import PQueue from "p-queue";

const queue = new PQueue({ concurrency: 2 });
const QUEUE_MAX = 8;

export async function rateLimitMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (queue.size >= QUEUE_MAX) {
    res.status(429).json({
      error: "Too many requests. Please try again shortly.",
      retryAfterSeconds: 10,
    });
    return;
  }

  await queue.add(() => new Promise<void>((resolve) => {
    next();
    resolve();
  }));
}
