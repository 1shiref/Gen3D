interface Props {
  value: string;
  onChange: (v: string) => void;
}

const PLACEHOLDERS = [
  "A cute low-poly fox figurine sitting upright, smooth rounded body, plain background",
  "A small coiled dragon resting on a round base",
  "A chunky ceramic mug with a thick handle and matte glaze",
  "A miniature potted succulent in a hexagonal pot",
];

export default function TextPrompt({ value, onChange }: Props) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">
        Text Prompt
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={PLACEHOLDERS[0]}
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
      />
      <p className="text-xs text-muted-foreground text-right mt-0.5">{value.length} chars</p>
    </div>
  );
}
