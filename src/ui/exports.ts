import { type Inputs, type Plan, DEFAULT_INPUTS, toRoomShape } from "../domain/index.ts";

/** Trigger a browser download of text content. */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Cut list + offcut-reuse remainders as CSV. */
export function cutListToCsv(plan: Plan): string {
  const reuse = new Map(plan.reuseMap.map((r) => [r.usedByPieceId, r]));
  const header = [
    "row",
    "piece",
    "type",
    "length_mm",
    "width_mm",
    "reused",
    "source",
    "offcut_remainder_mm",
  ];
  const lines = plan.cutList.map((c) => {
    const r = reuse.get(c.pieceId);
    return [
      c.rowIndex + 1,
      c.indexInRow + 1,
      c.kind,
      Math.round(c.length),
      Math.round(c.width),
      c.reused ? "yes" : "no",
      c.source,
      r ? Math.round(r.remainder) : "",
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

/** Serialize the current inputs as a portable project file. */
export function projectToJson(inputs: Inputs): string {
  return JSON.stringify({ kind: "floor-planner-project", version: 1, inputs }, null, 2);
}

/** Parse a project file; throws on a malformed/incompatible file. */
export function projectFromJson(text: string): Inputs {
  const parsed = JSON.parse(text) as { kind?: string; inputs?: Inputs };
  if (parsed.kind !== "floor-planner-project" || !parsed.inputs) {
    throw new Error("Not a valid floor-planner project file.");
  }
  // Back-compat: migrate a legacy four-measurement room into the polygon shape.
  return {
    ...parsed.inputs,
    room: toRoomShape((parsed.inputs as { room?: unknown }).room, DEFAULT_INPUTS.room),
  };
}
