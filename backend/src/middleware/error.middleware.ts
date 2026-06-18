import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error(err.message, err.stack);
  res.status(500).json({
    error: err.message ?? "Internal server error",
    code: (err as NodeJS.ErrnoException).code ?? "SERVER_ERROR",
  });
}
