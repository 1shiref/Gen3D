import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Boxes } from "lucide-react";
import { uploadModel } from "@/lib/api";
import { useCandidateStore } from "@/stores/candidateStore";
import { useToast } from "@/hooks/useToast";

const MAX_BYTES = 100 * 1024 * 1024;

const ACCEPTED = {
  "model/stl": [".stl"],
  "model/obj": [".obj"],
  "model/gltf-binary": [".glb"],
  "model/gltf+json": [".gltf"],
  // browsers often report unknown / generic types — let the backend ext-check enforce safety
  "application/octet-stream": [".stl", ".obj", ".glb", ".gltf"],
};

export default function ModelUpload() {
  const addExternal = useCandidateStore((s) => s.addExternal);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [lastName, setLastName] = useState<string | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      setBusy(true);
      try {
        const result = await uploadModel(file);
        // Register as a selectable candidate (and make it active).
        addExternal({
          engineId: `upload:${result.ref}`,
          engineLabel: result.originalName,
          kind: "uploaded",
          url: result.url,
          format: result.extension,
          name: result.originalName,
        });
        setLastName(result.originalName);
        toast({ title: "Model loaded", description: result.originalName });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast({ title: "Upload failed", description: msg, variant: "destructive" });
      } finally {
        setBusy(false);
      }
    },
    [addExternal, toast],
  );

  const onDropRejected = useCallback(
    (rejections: FileRejection[]) => {
      const first = rejections[0];
      if (!first) return;
      const reason = first.errors[0]?.code === "file-too-large"
        ? `File exceeds the 100 MB limit (${(first.file.size / 1024 / 1024).toFixed(1)} MB)`
        : `Unsupported file type — accepted: STL, OBJ, GLB, GLTF`;
      toast({ title: "Upload rejected", description: reason, variant: "destructive" });
    },
    [toast],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPTED,
    maxFiles: 1,
    maxSize: MAX_BYTES,
    disabled: busy,
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        } ${busy ? "opacity-50 cursor-wait" : ""}`}
      >
        <input {...getInputProps()} />
        <Boxes className="mx-auto mb-1 w-5 h-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {busy
            ? "Uploading…"
            : isDragActive
              ? "Drop 3D file here"
              : "Drop a 3D model to view & edit"}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">STL · OBJ · GLB · GLTF (≤100 MB)</p>
      </div>
      {lastName && !busy && (
        <p className="text-[10px] text-muted-foreground mt-1 truncate" title={lastName}>
          Loaded: {lastName}
        </p>
      )}
    </div>
  );
}
