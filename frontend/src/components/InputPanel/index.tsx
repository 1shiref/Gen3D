import { useGenerationStore } from "@/stores/generationStore";
import ImageDropzone from "./ImageDropzone";
import ImageRefineActions from "./ImageRefineActions";
import ModelUpload from "./ModelUpload";
import TextPrompt from "./TextPrompt";
import EnhanceButton from "./EnhanceButton";
import EnginePicker from "./EnginePicker";
import GenerateButton from "./GenerateButton";
import ProcessLog from "@/components/ProcessLog";
import HelpTip from "@/components/UI/HelpTip";

export default function InputPanel() {
  const store = useGenerationStore();

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="flex items-center gap-1.5 mb-3">
          <h2 className="text-sm font-semibold text-foreground">Input</h2>
          <HelpTip id="input" />
        </div>

        <ImageDropzone
          images={store.images}
          onChange={store.setImages}
        />
        <div className="mt-2">
          <ImageRefineActions />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <ModelUpload />
      </div>

      <div>
        <TextPrompt
          value={store.prompt}
          onChange={store.setPrompt}
        />
        <div className="mt-1 flex justify-end">
          <EnhanceButton />
        </div>
      </div>

      <EnginePicker />

      <div data-tour="generate" className="flex items-center gap-2">
        <div className="flex-1">
          <GenerateButton />
        </div>
        <HelpTip id="generate" />
      </div>

      {store.status === "error" && store.errorMessage && (
        <div className="text-xs text-destructive bg-destructive/10 rounded p-2">
          {store.errorMessage}
        </div>
      )}

      {/* Live step-by-step process log: what's running and what it uses */}
      <ProcessLog variant="inline" />

      {store.printabilityWarnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {store.printabilityWarnings.map((w, i) => (
            <div key={i} className="text-xs text-yellow-500 bg-yellow-500/10 rounded px-2 py-1">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      {store.materialSuggestion && (
        <div className="text-xs text-blue-400 bg-blue-400/10 rounded px-2 py-1">
          Material suggestion: {store.materialSuggestion}
        </div>
      )}
    </div>
  );
}
