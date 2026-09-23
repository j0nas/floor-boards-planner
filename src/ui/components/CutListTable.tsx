import type { CutItem, Plan } from "../../domain/index.ts";
import { boardPartners, rowLabel } from "../exports.ts";

function roleLabel(c: CutItem): string {
  switch (c.role) {
    case "full":
      return c.kind === "taper" ? "full · taper" : "full";
    case "start":
      return c.kind === "taper" ? "start · taper" : "start";
    case "end":
      return c.kind === "taper" ? "end · taper" : "end";
    case "free":
      return "whole row";
  }
}

const mm = (v: number) => Math.round(v).toString();

/** Length, with both long edges when the end is cut at an angle. */
function lengthText(c: CutItem): string {
  return c.lengthShort === undefined ? mm(c.length) : `${mm(c.length)} / ${mm(c.lengthShort)}`;
}

/** Width, with the width at each end (in laying direction) for a taper rip. */
function widthText(c: CutItem): string {
  if (c.widthNarrow === undefined) return mm(c.width);
  if (c.notched) return `${mm(c.width)} (tab ${mm(c.widthNarrow)})`;
  return c.narrowAtEnd
    ? `${mm(c.width)}→${mm(c.widthNarrow)}`
    : `${mm(c.widthNarrow)}→${mm(c.width)}`;
}

/** The piece's role, and whether it reaches into (or lies in) a doorway. */
function pieceText(plan: Plan, c: CutItem): string {
  const notch = c.notched ? " · notched" : "";
  if (c.opening === undefined) return roleLabel(c) + notch;
  if (rowLabel(plan, c).startsWith("door"))
    return (c.role === "free" ? "doorway strip" : `${roleLabel(c)} · doorway`) + notch;
  return `${roleLabel(c)}${notch} · into door ${c.opening + 1}`;
}

export function CutListTable({ plan }: { plan: Plan }) {
  const fulls = plan.cutList.filter((c) => c.role === "full").length;
  const cuts = plan.cutList.length - fulls;
  const angled = plan.cutList.some((c) => c.lengthShort !== undefined);
  const tapered = plan.cutList.some((c) => c.widthNarrow !== undefined && !c.notched);
  const notched = plan.cutList.some((c) => c.notched);
  const doors = plan.cutList.some((c) => c.opening !== undefined);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-slate-500">
        {plan.cutList.length} pieces from {plan.material.boardsConsumed} boards — {fulls} full,{" "}
        {cuts} cut. {plan.reuseMap.length} pieces come from the offcut of a board opened earlier.
      </p>
      <p className="text-[11px] text-slate-500">
        Boards are numbered in laying order. A <b>start</b> piece keeps the board end that clicks
        into the next board and an <b>end</b> piece keeps the opposite end, so one board gives at
        most one of each — the offcut from a row&rsquo;s end starts another row.
        {angled ? " Length a / b: the end is cut at an angle — long edge / short edge." : ""}
        {tapered ? " Width a→b: a taper rip, start end → far end (laying direction)." : ""}
        {doors
          ? " Door rows are strips laid in a doorway, clicked onto the row beside it and fitted last."
          : ""}
        {notched
          ? " Notched: L-shaped where it enters a doorway — length along each edge, and the tab's width."
          : ""}
      </p>
      <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left font-medium">Row</th>
              <th className="px-2 py-1 text-left font-medium">#</th>
              <th className="px-2 py-1 text-left font-medium">Piece</th>
              <th className="px-2 py-1 text-right font-medium">Length</th>
              <th className="px-2 py-1 text-right font-medium">Width</th>
              <th className="px-2 py-1 text-left font-medium">Board</th>
            </tr>
          </thead>
          <tbody>
            {plan.cutList.map((c) => {
              const partners = boardPartners(plan, c);
              return (
                <tr key={c.pieceId} className="border-t border-slate-100">
                  <td className="px-2 py-1 text-left tabular-nums">{rowLabel(plan, c)}</td>
                  <td className="px-2 py-1 text-left tabular-nums">{c.indexInRow + 1}</td>
                  <td className="px-2 py-1 text-left">{pieceText(plan, c)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{lengthText(c)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{widthText(c)}</td>
                  <td className="px-2 py-1 text-left">
                    <span className={c.role === "full" ? "text-slate-400" : "text-slate-700"}>
                      {c.source}
                    </span>
                    {partners ? (
                      <span className={c.reused ? "text-emerald-700" : "text-slate-500"}>
                        {c.reused ? " · offcut of " : " · offcut → "}
                        {partners}
                      </span>
                    ) : null}
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
