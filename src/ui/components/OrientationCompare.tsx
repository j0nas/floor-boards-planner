import { type Axis, type Plan, type PlanResult, type RoomShape, longAxis } from "../../domain/index.ts";
import type { ViewSelection } from "../state/usePlannerState.ts";

interface Props {
  result: PlanResult;
  view: ViewSelection;
  setView: (v: ViewSelection) => void;
  activePlan: Plan;
  activeOptionIndex: number;
  room: RoomShape;
}

function stagger(p: Plan): number {
  return Number.isFinite(p.stagger.minObservedStagger)
    ? p.stagger.minObservedStagger
    : p.stagger.achievedStagger;
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-1 text-right tabular-nums">{children}</td>;
}

export function OrientationCompare({
  result,
  view,
  setView,
  activePlan,
  activeOptionIndex,
  room,
}: Props) {
  // "length" tracks the longer room side, so the labels match the drawing.
  const long = longAxis(room);
  const axisLabel = (a: Axis) => (a === long ? "Along length" : "Along width");
  const activeAxis = view.axis ?? result.chosenAxis;
  const rows: { axis: Axis; plan: Plan | null }[] = [
    { axis: "X", plan: result.plans.X },
    { axis: "Y", plan: result.plans.Y },
  ];

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="px-2 py-1 text-left font-medium">Orientation</th>
            <th className="px-2 py-1 text-right font-medium">Stagger</th>
            <th className="px-2 py-1 text-right font-medium">Waste</th>
            <th className="px-2 py-1 text-right font-medium">Boards</th>
            <th className="px-2 py-1 text-right font-medium">View</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ axis, plan }) => {
            const isChosen = axis === result.chosenAxis;
            const isActive = axis === activeAxis;
            return (
              <tr
                key={axis}
                className={`border-t border-slate-100 ${isActive ? "bg-sky-50" : ""}`}
              >
                <td className="px-2 py-1 text-left">
                  <span className="font-medium text-slate-700">{axisLabel(axis)}</span>
                  {isChosen && !result.forced ? (
                    <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">
                      best
                    </span>
                  ) : null}
                  {!plan?.valid ? (
                    <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-700">
                      invalid
                    </span>
                  ) : null}
                </td>
                <Cell>{plan ? `${Math.round(stagger(plan))} mm` : "—"}</Cell>
                <Cell>{plan ? `${plan.material.consumedWastePct.toFixed(1)}%` : "—"}</Cell>
                <Cell>{plan ? plan.material.boardsConsumed : "—"}</Cell>
                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    disabled={!plan}
                    onClick={() => setView({ ...view, axis })}
                    className={`rounded px-2 py-0.5 text-[11px] ${
                      isActive
                        ? "bg-sky-600 text-white"
                        : "border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    }`}
                  >
                    {isActive ? "shown" : "show"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {result.comparison.map((d, i) => (
        <p key={i} className="text-[11px] text-slate-500">
          {d.message}
        </p>
      ))}

      {activePlan.layoutOptions.length > 1 ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Border layout
          </span>
          <div className="flex flex-wrap gap-1">
            {activePlan.layoutOptions.map((opt, i) => (
              <button
                key={opt.kind}
                type="button"
                onClick={() => setView({ ...view, optionIndex: i })}
                className={`rounded border px-2 py-1 text-[11px] ${
                  i === activeOptionIndex
                    ? "border-sky-500 bg-sky-50 text-sky-700"
                    : "border-slate-300 text-slate-600 hover:bg-slate-100"
                }`}
                title={opt.reason}
              >
                {opt.kind}
                {opt.recommended ? " ★" : ""}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
            {activePlan.layoutOptions[activeOptionIndex]?.reason}
          </p>
        </div>
      ) : null}
    </div>
  );
}
