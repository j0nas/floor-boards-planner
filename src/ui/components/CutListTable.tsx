import { useMemo } from "react";
import type { Plan } from "../../domain/index.ts";

function kindLabel(kind: string): string {
  switch (kind) {
    case "full":
      return "full";
    case "cut-length":
      return "cut";
    case "taper":
      return "taper";
    default:
      return kind;
  }
}

export function CutListTable({ plan }: { plan: Plan }) {
  const reuseByPiece = useMemo(
    () => new Map(plan.reuseMap.map((r) => [r.usedByPieceId, r])),
    [plan.reuseMap],
  );

  const cuts = plan.cutList.filter((c) => c.kind !== "full");
  const fulls = plan.cutList.length - cuts.length;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-slate-500">
        {plan.cutList.length} pieces — {fulls} full boards, {cuts.length} cut. Offcut reuse:{" "}
        {plan.reuseMap.length} pieces taken from earlier offcuts.
      </p>
      <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Row</th>
              <th className="px-2 py-1 text-left font-medium">#</th>
              <th className="px-2 py-1 text-left font-medium">Type</th>
              <th className="px-2 py-1 text-right font-medium">Length</th>
              <th className="px-2 py-1 text-right font-medium">Width</th>
              <th className="px-2 py-1 text-left font-medium">From</th>
            </tr>
          </thead>
          <tbody>
            {plan.cutList.map((c) => {
              const reuse = reuseByPiece.get(c.pieceId);
              return (
                <tr key={c.pieceId} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-left tabular-nums">{c.rowIndex + 1}</td>
                  <td className="px-2 py-1 text-left tabular-nums">{c.indexInRow + 1}</td>
                  <td className="px-2 py-1 text-left">{kindLabel(c.kind)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{Math.round(c.length)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{Math.round(c.width)}</td>
                  <td className="px-2 py-1 text-left">
                    {c.reused ? (
                      <span className="text-emerald-700">
                        offcut {c.source}
                        {reuse ? ` (${Math.round(reuse.remainder)} mm left)` : ""}
                      </span>
                    ) : c.kind === "full" ? (
                      <span className="text-slate-400">board {c.source}</span>
                    ) : (
                      <span className="text-slate-600">new board {c.source}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
