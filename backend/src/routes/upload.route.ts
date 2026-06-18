import { Router } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config";
import { ensureUploadsDir, fileUrl } from "../utils/file-helpers";

ensureUploadsDir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Separate multer config for 3D model uploads: larger size cap, different extension set.
const MODEL_EXTS = [".stl", ".obj", ".glb", ".gltf"];
const modelUpload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, MODEL_EXTS.includes(ext));
  },
});

const router = Router();

router.post("/upload", upload.array("images", 8), (req, res) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No images uploaded" });
    return;
  }

  const fileRefs = files.map((f) => ({
    ref: f.filename,
    path: f.path,
    url: fileUrl(f.filename),
    originalName: f.originalname,
  }));

  res.json({ fileRefs });
});

// 3D model upload — STL, OBJ, GLB, GLTF
router.post("/upload-model", modelUpload.single("model"), (req, res) => {
  const file = req.file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({
      error: `No model uploaded (supported: ${MODEL_EXTS.join(", ")}, max 100 MB)`,
    });
    return;
  }
  const ext = path.extname(file.originalname).toLowerCase().slice(1); // "stl"
  res.json({
    ref: file.filename,
    url: fileUrl(file.filename),
    originalName: file.originalname,
    extension: ext,
    sizeBytes: file.size,
  });
});

export default router;
