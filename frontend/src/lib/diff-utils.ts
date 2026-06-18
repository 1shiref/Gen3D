import * as Diff from "diff";

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
  lineNumber?: number;
}

export function computeScadDiff(oldCode: string, newCode: string): DiffLine[] {
  const changes = Diff.diffLines(oldCode, newCode);
  const lines: DiffLine[] = [];
  let lineNum = 1;

  for (const part of changes) {
    const partLines = part.value.split("\n");
    if (partLines[partLines.length - 1] === "") partLines.pop();

    for (const line of partLines) {
      if (part.added) {
        lines.push({ type: "added", content: line, lineNumber: lineNum++ });
      } else if (part.removed) {
        lines.push({ type: "removed", content: line });
      } else {
        lines.push({ type: "unchanged", content: line, lineNumber: lineNum++ });
      }
    }
  }

  return lines;
}
