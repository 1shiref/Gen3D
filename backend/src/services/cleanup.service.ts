import fs from "fs";
import path from "path";
import { config, getProviderFallbackOrder, isBillingFailed, getBillingFailedIds } from "../config";
import { testProviderEntry } from "./ai-provider";
import { logger } from "../utils/logger";

let cleanupTimer: NodeJS.Timeout | null = null;
let billingRecheckTimer: NodeJS.Timeout | null = null;

const BILLING_RECHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function startCleanupJob(): void {
  if (cleanupTimer !== null) return; // already running

  cleanupTimer = setInterval(() => {
    try {
      if (!fs.existsSync(config.uploadsDir)) return;
      const files = fs.readdirSync(config.uploadsDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(config.uploadsDir, file);
        try {
          const stat = fs.statSync(filePath);
          const age = now - stat.mtimeMs;

          if (age > config.uploadMaxAgeMs) {
            fs.unlinkSync(filePath);
            logger.debug(`Cleaned up old file: ${file}`);
          }
        } catch {
          // File disappeared between readdir and stat — ignore
        }
      }
    } catch (err) {
      logger.error("Cleanup job error", err);
    }
  }, Math.min(config.uploadMaxAgeMs, 5 * 60 * 1000));
}

export function stopCleanupJob(): void {
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// Re-tests entries currently marked billing-failed.
// testProviderEntry auto-clears the mark on success (see ai-provider.ts).
async function recheckBillingFailed(): Promise<void> {
  const failedIds = getBillingFailedIds();
  if (failedIds.length === 0) return;

  const chain = getProviderFallbackOrder();
  const toRecheck = chain.filter((e) => isBillingFailed(e.id));
  if (toRecheck.length === 0) return;

  logger.debug(`Billing recheck: testing ${toRecheck.length} failed provider(s)`);
  for (const entry of toRecheck) {
    try {
      await testProviderEntry(entry);
    } catch (err) {
      logger.debug(`Billing recheck error for ${entry.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function startBillingRecheckJob(): void {
  if (billingRecheckTimer !== null) return;
  billingRecheckTimer = setInterval(() => {
    recheckBillingFailed().catch((err) => logger.error("Billing recheck job error", err));
  }, BILLING_RECHECK_INTERVAL_MS);
}

export function stopBillingRecheckJob(): void {
  if (billingRecheckTimer !== null) {
    clearInterval(billingRecheckTimer);
    billingRecheckTimer = null;
  }
}
