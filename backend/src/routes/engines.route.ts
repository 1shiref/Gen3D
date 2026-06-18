import { Router } from "express";
import { engineCatalog } from "../services/engines";

const router = Router();

/** Catalog of generation engines so the UI can render the engine checklist. */
router.get("/engines", (_req, res) => {
  res.json({
    engines: engineCatalog().map((e) => ({
      id: e.id,
      label: e.label,
      kind: e.kind,
      needsImage: e.needsImage,
      available: e.available,
    })),
  });
});

export default router;
