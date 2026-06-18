import { useCallback } from "react";
import { fetchGenerateStream, textToImageStream, refineImageStream, uploadImages, buildFileUrl } from "@/lib/api";
import { useGenerationStore } from "@/stores/generationStore";
import { useCandidateStore, type Candidate } from "@/stores/candidateStore";
import { useImageStageStore, type PendingImage } from "@/stores/imageStageStore";
import { useEngineStore, availableEngineIds } from "@/stores/engineStore";
import { getSelectedPrinter } from "@/stores/printerStore";
import { useProcessStore } from "@/stores/processStore";
import { useToast } from "./useToast";

/** Split a "Action · Tool" status message into label + detail for the Process Log. */
export function splitStatus(message: string): { label: string; detail?: string } {
  const i = message.indexOf(" · ");
  if (i === -1) return { label: message };
  return { label: message.slice(0, i), detail: message.slice(i + 3) };
}

export function useGenerate() {
  const store = useGenerationStore();
  const { toast } = useToast();

  /**
   * Run the neural engines and stream candidates. Shared by the uploaded-image path and the
   * confirmed text→photo path (Phase B). Pass `files` OR `imageRefs` (a confirmed cutout).
   */
  const runEngineStream = useCallback(
    async (source: { files?: File[]; imageRefs?: string[]; engines?: string[]; referenceUrl?: string }) => {
      const s = useGenerationStore.getState();
      const cand = useCandidateStore.getState();

      // Revoke any prior blob URL before s.reset() drops the reference, to avoid a leak.
      const priorRef = s.referenceImageUrl;
      if (priorRef?.startsWith("blob:")) URL.revokeObjectURL(priorRef);

      s.reset();
      s.setStatus("streaming");
      s.setStatusMessage(null);
      cand.reset(); // fresh run — clear previous candidates/plan

      // Persist the source image so it stays visible (viewer reference thumbnail) past
      // the photo-review step. Uploaded files → blob URL; confirmed photo → its servable URL.
      const referenceUrl = source.files?.[0]
        ? URL.createObjectURL(source.files[0])
        : source.referenceUrl ?? null;
      s.setReferenceImageUrl(referenceUrl);

      const proc = useProcessStore.getState();
      proc.start("Generating candidates");

      try {
        const printer = getSelectedPrinter();
        const gen = fetchGenerateStream({
          files: source.files,
          imageRefs: source.imageRefs,
          prompt: s.prompt,
          engines: source.engines ?? s.selectedEngines,
          forceProviderId: s.forceProviderId,
          printerPreset: printer.id,
          bedSize: { w: printer.bedWidth, d: printer.bedDepth, h: printer.bedHeight },
        });

        for await (const { event, data } of gen) {
          switch (event) {
            case "engines": {
              const { engines } = JSON.parse(data) as { engines: { id: string; label: string }[] };
              useCandidateStore.getState().startRun(engines);
              proc.step("Running engines", engines.map((e) => e.label).join(", "));
              break;
            }

            case "status": {
              const st = JSON.parse(data) as { engineId?: string; message: string };
              store.setStatusMessage(st.message);
              const { label, detail } = splitStatus(st.message);
              proc.step(label, detail);
              break;
            }

            case "candidate_ready": {
              const c = JSON.parse(data) as Candidate;
              useCandidateStore.getState().addCandidate(c);
              proc.step(`Candidate ready · ${c.engineLabel}`);
              toast({ title: `Candidate ready · ${c.engineLabel}` });
              break;
            }

            case "candidate_failed": {
              const f = JSON.parse(data) as { engineId: string; error: string };
              useCandidateStore.getState().failCandidate(f.engineId, f.error);
              break;
            }

            case "done":
              store.setStatusMessage(null);
              break;

            case "error": {
              const errPayload = JSON.parse(data) as { message: string };
              store.setError(errPayload.message);
              proc.fail(errPayload.message);
              toast({ title: "Generation failed", description: errPayload.message, variant: "destructive" });
              break;
            }
          }
        }

        // Stream ended — summarize.
        const cs = useCandidateStore.getState();
        cs.finishRun();
        const gs = useGenerationStore.getState();
        if (cs.candidates.length === 0 && gs.status !== "error") {
          const why = cs.plan.find((p) => p.status === "failed")?.error;
          gs.setError(why ? `All engines failed. e.g. ${why}` : "No candidates were produced.");
          proc.fail("No candidates produced");
        } else if (cs.candidates.length > 0) {
          gs.setStatus("done");
          proc.done();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed";
        useGenerationStore.getState().setError(msg);
        useProcessStore.getState().fail(msg);
        useCandidateStore.getState().finishRun();
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    },
    [store, toast],
  );

  /** Run the 3D engines on a ready photo (Phase B). The provider scope (fal / hf / both)
   * filters the selected engines. Shared by manual confirm and the auto-confirm path. */
  const runFromPhoto = useCallback(async (pending: PendingImage) => {
    // The text→3D path is driven by the fal/HF/Both scope against what the server offers,
    // not the (image-blocked) engine checkboxes. Ensure the catalog is loaded first.
    await useEngineStore.getState().load();
    const all = availableEngineIds(useEngineStore.getState().engines);
    const scope = useImageStageStore.getState().provider;
    const engines =
      scope === "fal" ? all.filter((id) => id.startsWith("fal:"))
      : scope === "hf" ? all.filter((id) => id.startsWith("hf:"))
      : all;

    if (engines.length === 0) {
      toast({
        title: "No engine selected",
        description: `No ${scope === "both" ? "" : scope + " "}engine is selected. Pick at least one in the engine list.`,
        variant: "destructive",
      });
      useImageStageStore.getState().reset();
      return;
    }

    // Capture the photo's URL before leaving the image stage, so it can persist as a reference.
    const referenceUrl = buildFileUrl(pending.url);
    useImageStageStore.getState().reset();
    await runEngineStream({ imageRefs: [pending.ref], engines, referenceUrl });
  }, [runEngineStream, toast]);

  /**
   * Phase A — run ONE image operation on the current working image and stream the result back
   * into the review overlay. `mode` picks the pipeline: "text" → text→image (no input);
   * "reimagine"/"enhance" → refine the current image (`imageStage.current.ref`). Callers set the
   * stage to "generating" (beginOp) first; the result becomes the new `current` (setResult).
   *
   * Only when `allowAutoConfirm` is set (Smart Plan) AND the user's autoConfirm pref is on do
   * we run 3D immediately; the normal flow always stops at the review overlay.
   */
  const applyOp = useCallback(async (mode: "text" | "reimagine" | "enhance", allowAutoConfirm = false) => {
    const s = useGenerationStore.getState();
    const st = useImageStageStore.getState();
    s.setStatus("streaming");

    const proc = useProcessStore.getState();
    proc.start(mode === "reimagine" ? "Reimagining photo" : mode === "enhance" ? "Enhancing photo" : "Generating photo");

    try {
      const gen =
        mode === "text"
          ? textToImageStream({ prompt: s.prompt })
          : refineImageStream({
              imageRef: st.current?.ref ?? "",
              mode,
              prompt: s.prompt,
              ops: st.ops,
            });

      let ready = false;
      let autoPending: PendingImage | null = null;
      for await (const { event, data } of gen) {
        switch (event) {
          case "status": {
            const msg = JSON.parse(data) as { message: string };
            store.setStatusMessage(msg.message);
            const { label, detail } = splitStatus(msg.message);
            proc.step(label, detail);
            break;
          }
          case "image_ready": {
            const img = JSON.parse(data) as { ref: string; url: string };
            ready = true;
            store.setStatusMessage(null);
            proc.done();
            if (allowAutoConfirm && useImageStageStore.getState().autoConfirm) {
              // Hands-free (Smart Plan): skip the review overlay and run 3D after the stream ends.
              autoPending = img;
            } else {
              useImageStageStore.getState().setResult(img);
              store.setStatus("idle");
            }
            break;
          }
          case "error": {
            const errPayload = JSON.parse(data) as { message: string };
            ready = true; // error already surfaced — don't also emit the generic message below
            useImageStageStore.getState().setError(errPayload.message);
            store.setError(errPayload.message);
            proc.fail(errPayload.message);
            toast({ title: "Photo generation failed", description: errPayload.message, variant: "destructive" });
            break;
          }
        }
      }
      if (!ready) {
        const msg = "No photo was produced.";
        useImageStageStore.getState().setError(msg);
        store.setError(msg);
        proc.fail(msg);
      } else if (autoPending) {
        // Auto-confirm: hand the fresh photo straight to the 3D engines.
        await runFromPhoto(autoPending);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Photo generation failed";
      useImageStageStore.getState().setError(msg);
      useGenerationStore.getState().setError(msg);
      useProcessStore.getState().fail(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  }, [store, toast, runFromPhoto]);

  /** Phase A entry (Generate button / Smart Plan) — synthesize a photo from the text prompt. */
  const startImageStage = useCallback(async (allowAutoConfirm = false) => {
    const s = useGenerationStore.getState();
    if (s.status === "streaming" || s.status === "compiling") return;
    if (!s.prompt.trim()) {
      s.setError("Provide a text prompt to generate a photo.");
      return;
    }
    useImageStageStore.getState().start();
    s.reset();
    s.setStatusMessage(null);
    useCandidateStore.getState().reset();
    await applyOp("text", allowAutoConfirm);
  }, [applyOp]);

  /**
   * Apply a refine operation ("reimagine" or "enhance"). Works both as a fresh entry from the
   * input panel (uploads the first image to seed the chain) and as a chained step in the review
   * overlay (operates on the current working image). Reimagine requires a text prompt.
   */
  const runRefine = useCallback(async (mode: "reimagine" | "enhance") => {
    const s = useGenerationStore.getState();
    if (s.status === "streaming" || s.status === "compiling") return;
    if (mode === "reimagine" && !s.prompt.trim()) {
      s.setError("Provide a text prompt to reimagine the image.");
      return;
    }

    const st = useImageStageStore.getState();
    if (st.current) {
      // Chaining: run on the current working image.
      st.beginOp(mode);
      await applyOp(mode);
      return;
    }

    // Fresh entry from the input panel — seed the chain from the first uploaded image.
    if (s.images.length === 0) {
      s.setError("Add an image to refine.");
      return;
    }
    st.beginOp(mode); // overlay shows generating immediately
    s.reset();
    s.setStatus("streaming");
    s.setStatusMessage("Uploading image…");
    useCandidateStore.getState().reset();
    try {
      const { fileRefs } = await uploadImages([s.images[0]]);
      const f = fileRefs[0];
      if (!f) throw new Error("Upload returned no image");
      useImageStageStore.getState().beginFromImage({ ref: f.ref, url: f.url });
      await applyOp(mode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not prepare the image";
      useImageStageStore.getState().setError(msg);
      useGenerationStore.getState().setError(msg);
      useProcessStore.getState().fail(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  }, [applyOp, toast]);

  /**
   * Open the refine popup seeded with the first uploaded image, without running any operation.
   * The user then chooses Enhance / Reimagine (or "Use this") inside the popup.
   */
  const openRefine = useCallback(async () => {
    const s = useGenerationStore.getState();
    if (s.status === "streaming" || s.status === "compiling") return;
    if (s.images.length === 0) {
      s.setError("Add an image to refine.");
      return;
    }

    const st = useImageStageStore.getState();
    st.beginOp("enhance"); // show the popup immediately (label overridden by the status message)
    s.reset();
    s.setStatus("streaming");
    s.setStatusMessage("Loading image…");
    useCandidateStore.getState().reset();
    try {
      const { fileRefs } = await uploadImages([s.images[0]]);
      const f = fileRefs[0];
      if (!f) throw new Error("Upload returned no image");
      useImageStageStore.getState().openFromImage({ ref: f.ref, url: f.url });
      useGenerationStore.getState().setStatusMessage(null);
      useGenerationStore.getState().setStatus("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not load the image";
      useImageStageStore.getState().setError(msg);
      useGenerationStore.getState().setError(msg);
      useProcessStore.getState().fail(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  }, [toast]);

  /** Confirm the current working image and run the 3D engines on it. */
  const confirmImage = useCallback(async () => {
    const current = useImageStageStore.getState().current;
    if (!current) return;
    await runFromPhoto(current);
  }, [runFromPhoto]);

  /**
   * Entry point for the Generate button. Uploaded images → straight to 3D engines (unchanged).
   * Text only → synthesize a reviewable photo first (Phase A).
   */
  const generate = useCallback(async (opts?: { allowAutoConfirm?: boolean }) => {
    const s = useGenerationStore.getState();
    if (s.status === "streaming" || s.status === "compiling") return;

    if (s.images.length > 0) {
      useImageStageStore.getState().reset();
      await runEngineStream({ files: s.images });
    } else {
      await startImageStage(opts?.allowAutoConfirm ?? false);
    }
  }, [runEngineStream, startImageStage]);

  return {
    generate,
    openRefine,
    confirmImage,
    enhance: () => runRefine("enhance"),
    reimagine: () => runRefine("reimagine"),
    undo: () => useImageStageStore.getState().undo(),
    status: store.status,
  };
}
