import { type Plan, mm2ToM2 } from "../../domain/index.ts";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800">{value}</div>
      {sub ? <div className="text-[11px] text-slate-400">{sub}</div> : null}
    </div>
  );
}

export function MaterialSummary({ plan }: { plan: Plan }) {
  const m = plan.material;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat
          label="Boards needed"
          value={`${m.boardsConsumed}`}
          sub={`${m.fullBoards} full · ${m.cutPieces} cut`}
        />
        <Stat label="Packs (min)" value={`${m.packsConsumed}`} sub={`${m.boardsPerPack}/pack`} />
        <Stat
          label="Waste"
          value={`${m.consumedWastePct.toFixed(1)}%`}
          sub={`covered ${mm2ToM2(m.coveredAreaMm2).toFixed(2)} m²`}
        />
        <Stat
          label="Buy"
          value={`${m.recommendedPurchasePacks} packs`}
          sub={`${m.recommendedPurchaseBoards} boards incl. spares`}
        />
        <Stat label="Safety spares" value={`+${m.safetyBoards}`} sub="miscuts & repairs" />
        <Stat
          label="After purchase"
          value={`${m.purchaseWastePct.toFixed(1)}%`}
          sub="spare/offcut share"
        />
      </div>
      <p className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{m.dyeLotNote}</p>
    </div>
  );
}
