import express from "express";
import path from "path";
import fs from "fs";
import { config, validateConfig } from "./config";
import { corsMiddleware } from "./middleware/cors.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import { ensureUploadsDir } from "./utils/file-helpers";
import { logger } from "./utils/logger";
import { startCleanupJob, startBillingRecheckJob } from "./services/cleanup.service";

import healthRouter from "./routes/health.route";
import uploadRouter from "./routes/upload.route";
import generateRouter from "./routes/generate.route";
import imageRouter from "./routes/image.route";
import enginesRouter from "./routes/engines.route";
import planEditRouter from "./routes/plan-edit.route";
import smartPlanRouter from "./routes/smart-plan.route";
import enhancePromptRouter from "./routes/enhance-prompt.route";
import sliceRouter from "./routes/slice.route";
import printRouter from "./routes/print.route";
import exportRouter from "./routes/export.route";
import modelsRouter from "./routes/models.route";
import settingsRouter from "./routes/settings.route";

validateConfig();
ensureUploadsDir();

const app = express();

app.use(corsMiddleware);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", healthRouter);
app.use("/api", uploadRouter);
app.use("/api", generateRouter);
app.use("/api", imageRouter);
app.use("/api", enginesRouter);
app.use("/api", planEditRouter);
app.use("/api", smartPlanRouter);
app.use("/api", enhancePromptRouter);
app.use("/api", sliceRouter);
app.use("/api", printRouter);
app.use("/api", exportRouter);
app.use("/api", modelsRouter);
app.use("/api", settingsRouter);

// Serve the built frontend (production). Single origin → relative `/api` calls and
// SSE work without the CORS allow-list. `npm run build` emits frontend/dist.
const clientDir = path.resolve(__dirname, "../../frontend/dist");
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  // SPA fallback for any non-/api route.
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
}

app.use(errorMiddleware);

app.listen(config.port, () => {
  logger.info(`Gen3D backend running at http://localhost:${config.port}`);
  startCleanupJob();
  startBillingRecheckJob();
});
