import {
  type Axis,
  type Inputs,
  type Orientation,
  type Plan,
  longAxis,
  mm2ToM2,
} from "../../domain/index.ts";
import { NumberField } from "./NumberField.tsx";

/** Orientation label tracking the room's proportions: "length" = the longer side. */
function axisLabel(room: Inputs["room"], axis: Axis): string {
  return axis === longAxis(room) ? "Along length" : "Along width";
}

interface Props {
  inputs: Inputs;
  setInputs: (updater: (prev: Inputs) => Inputs) => void;
  onReset: () => void;
  /** The plan currently shown — used to know whether *this* orientation tapers. */
  activePlan: Plan | null;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>
  );
}

export function InputsPanel({ inputs, setInputs, onReset, activePlan }: Props) {
  const set = (patch: (prev: Inputs) => Inputs) => setInputs(patch);

  // Area per pack is just the coverage of one board × boards in the pack — no
  // need to ask for it separately.
  const boardArea = inputs.board.length * inputs.board.width;
  const areaPerPackM2 = mm2ToM2(boardArea * (inputs.pack.boardsPerPack ?? 0));

  const orientationValue: "auto" | Axis =
    inputs.orientation.mode === "auto" ? "auto" : inputs.orientation.runAxis;
  const setOrientation = (v: "auto" | Axis) => {
    const orientation: Orientation =
      v === "auto" ? { mode: "auto" } : { mode: "forced", runAxis: v };
    set((p) => ({ ...p, orientation }));
  };

  // Flip is locked only for the orientation actually on screen, and only when its
  // cross axis tapers — there the border row is a taper pinned to the slanted
  // wall, so there is no other wall to flip it to. Rectangles, the square-cross
  // orientation of an out-of-square room, and custom (multi-wall) rooms all flip
  // freely: every row is clipped to the outline, so the cut row just mirrors over.
  const flipLocked = activePlan?.geometry.crossVaries === true;
  const flipped = inputs.flip === true;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Settings</h2>
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
        >
          Reset
        </button>
      </div>

      <p className="rounded-md bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
        Tip: edit the room dimensions on the plan and the board on the diagram above — everything
        recalculates as you type.
      </p>

      <section className="flex flex-col gap-2">
        <SectionTitle>Orientation</SectionTitle>
        <div className="flex gap-1 rounded-md bg-slate-100 p-1 text-xs">
          {(
            [
              ["auto", "Auto"],
              ["X", axisLabel(inputs.room, "X")],
              ["Y", axisLabel(inputs.room, "Y")],
            ] as ["auto" | Axis, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setOrientation(v)}
              className={`flex-1 rounded px-2 py-1 ${
                orientationValue === v
                  ? "bg-white font-medium text-sky-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-start justify-between gap-3 pt-0.5">
          <div className="flex flex-col">
            <span className="text-xs text-slate-600">Flip cut row to opposite wall</span>
            <span className="text-[10px] text-slate-400">
              {flipLocked
                ? "This orientation tapers along the slanted wall — switch to the other orientation to flip"
                : flipped
                  ? "Border row sits against the start wall"
                  : "Border row sits against the far wall"}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={flipped}
            disabled={flipLocked}
            onClick={() => set((p) => ({ ...p, flip: !p.flip }))}
            className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              flipped && !flipLocked ? "bg-sky-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                flipped && !flipLocked ? "left-4" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>Purchasing</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Boards / pack"
            value={inputs.pack.boardsPerPack ?? 0}
            onChange={(v) => set((p) => ({ ...p, pack: { ...p.pack, boardsPerPack: v } }))}
            suffix=""
            step={1}
            hint={`≈ ${areaPerPackM2.toFixed(2)} m²/pack`}
          />
          <NumberField
            label="On hand"
            value={inputs.boardsOnHand}
            onChange={(v) => set((p) => ({ ...p, boardsOnHand: v }))}
            suffix=""
            step={1}
            hint="boards already bought"
          />
        </div>
      </section>

      <details className="rounded-md border border-slate-200 p-2 text-sm">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
          Advanced
        </summary>

        <div className="mt-3 flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Per-wall expansion gap
          </span>
          <div className="grid grid-cols-2 gap-2">
            {(["near", "far", "left", "right"] as const).map((w) => (
              <NumberField
                key={w}
                label={w[0]!.toUpperCase() + w.slice(1)}
                value={inputs.gap[w]}
                onChange={(v) => set((p) => ({ ...p, gap: { ...p.gap, [w]: v } }))}
              />
            ))}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <NumberField
            label="Min row width"
            value={inputs.tunables.minRowWidth}
            onChange={(v) => set((p) => ({ ...p, tunables: { ...p.tunables, minRowWidth: v } }))}
          />
          <NumberField
            label="Min piece length"
            value={inputs.tunables.minPiece}
            onChange={(v) => set((p) => ({ ...p, tunables: { ...p.tunables, minPiece: v } }))}
          />
          <NumberField
            label="Min stagger"
            value={inputs.tunables.minStagger}
            onChange={(v) => set((p) => ({ ...p, tunables: { ...p.tunables, minStagger: v } }))}
          />
          <NumberField
            label="Ideal stagger"
            value={inputs.tunables.idealStagger}
            onChange={(v) => set((p) => ({ ...p, tunables: { ...p.tunables, idealStagger: v } }))}
          />
          <NumberField
            label="Saw kerf"
            value={inputs.tunables.kerf}
            onChange={(v) => set((p) => ({ ...p, tunables: { ...p.tunables, kerf: v } }))}
          />
          <NumberField
            label="Square tolerance"
            value={inputs.tunables.squareTol}
            onChange={(v) => set((p) => ({ ...p, tunables: { ...p.tunables, squareTol: v } }))}
          />
          <NumberField
            label="Min taper gap"
            value={inputs.tunables.minGap}
            onChange={(v) => set((p) => ({ ...p, tunables: { ...p.tunables, minGap: v } }))}
          />
          <NumberField
            label="Safety margin"
            value={Math.round(inputs.tunables.safetyMarginPct * 100)}
            onChange={(v) =>
              set((p) => ({ ...p, tunables: { ...p.tunables, safetyMarginPct: v / 100 } }))
            }
            suffix="%"
          />
        </div>
      </details>
    </div>
  );
}
