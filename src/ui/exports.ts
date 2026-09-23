import type { CutItem, Inputs, Plan } from "../domain/index.ts";
import { restoreInputs } from "./state/usePlannerState.ts";

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

/** The other pieces cut from the same board, e.g. "r4 #1". */
export function boardPartners(plan: Plan, c: CutItem): string {
  return plan.cutList
    .filter((o) => o.source === c.source && o.pieceId !== c.pieceId)
    .map((o) => `r${o.rowIndex + 1} #${o.indexInRow + 1}`)
    .join(", ");
}

/** Cut list as CSV — one row per piece, in laying order. */
export function cutListToCsv(plan: Plan): string {
  const reuse = new Map(plan.reuseMap.map((r) => [r.usedByPieceId, r]));
  const header = [
    "row",
    "piece",
    "type",
    "role",
    "length_mm",
    "length_short_edge_mm",
    "width_mm",
    "width_narrow_end_mm",
    "narrow_end",
    "board",
    "board_shared_with",
    "offcut_remainder_mm",
  ];
  const round = (v: number | undefined) => (v === undefined ? "" : Math.round(v));
  const lines = plan.cutList.map((c) => {
    const r = reuse.get(c.pieceId);
    return [
      c.rowIndex + 1,
      c.indexInRow + 1,
      c.kind,
      c.role,
      Math.round(c.length),
      round(c.lengthShort),
      Math.round(c.width),
      round(c.widthNarrow),
      c.widthNarrow === undefined ? "" : c.narrowAtEnd ? "far" : "start",
      c.source,
      boardPartners(plan, c),
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
  const parsed = JSON.parse(text) as { kind?: string; inputs?: Partial<Inputs> };
  if (parsed.kind !== "floor-planner-project" || !parsed.inputs) {
    throw new Error("Not a valid floor-planner project file.");
  }
  // Back-compat: migrate a legacy four-measurement room into the polygon shape,
  // and backfill anything added since the file was saved.
  return restoreInputs(parsed.inputs);
}
