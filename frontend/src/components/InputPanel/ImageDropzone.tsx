import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { X, ImagePlus } from "lucide-react";

interface Props {
  images: File[];
  onChange: (files: File[]) => void;
}

export default function ImageDropzone({ images, onChange }: Props) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      const combined = [...images, ...accepted].slice(0, 1);
      onChange(combined);
    },
    [images, onChange]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp"] },
    maxFiles: 1,
    disabled: images.length >= 1,
  });

  const remove = (idx: number) => {
    const next = images.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50"
        } ${images.length >= 1 ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <input {...getInputProps()} />
        <ImagePlus className="mx-auto mb-1 w-6 h-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {isDragActive ? "Drop an image here" : "Drag & drop an image"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP</p>
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-1">
          {images.map((file, i) => (
            <div key={i} className="relative group aspect-square">
              <img
                src={URL.createObjectURL(file)}
                alt={`Image ${i + 1}`}
                className="w-full h-full object-cover rounded"
              />
              <button
                onClick={() => remove(i)}
                className="absolute top-0 right-0 bg-black/50 text-white rounded-bl p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
