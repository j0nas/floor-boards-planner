import { useEffect, useMemo, useState } from "react";
import {
  type Inputs,
  type Piece,
  type Plan,
  type RectMeasurements,
  asRect,
  rectRoom,
  openingRings,
  roomOutline,
  uniformGap,
} from "../../domain/index.ts";
import { fitProjection } from "../svg/projection.ts";
import { EditableDim } from "./EditableDim.tsx";
import { SvgPlan } from "./SvgPlan.tsx";

interface Props {
  inputs: Inputs;
  setInputs: (updater: (prev: Inputs) => Inputs) => void;
  plan: Plan;
  pieces: Piece[];
  /** True when the expansion gap is flagged too small/negative — colours the chip red. */
  gapWarn: boolean;
}

/** Remembered per browser: whether the drawing is turned half a turn. */
const TURNED_KEY = "floor-planner:turned:v1";

function loadTurned(): boolean {
  try {
    return localStorage.getItem(TURNED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The plan IS the interface: for a rectangular/quad room the four measurements
 * are editable chips framing the drawing (each on the wall it measures), and the
 * expansion gap is an editable chip in the corner beside it — never on the
 * drawing, where it would hide a piece's label. Edit anything and the
 * floor redraws. (Multi-wall outlines are edited in the polygon editor instead.)
 * The drawing can be turned half a turn to match where you stand; the chips
 * move with their walls.
 */
export function PlanCanvas({ inputs, setInputs, plan, pieces, gapWarn }: Props) {
  const { room, gap } = inputs;
  const rect = asRect(room);
  const doors = useMemo(() => openingRings(inputs), [inputs]);
  const [turned, setTurned] = useState(loadTurned);
  useEffect(() => {
    try {
      localStorage.setItem(TURNED_KEY, turned ? "1" : "0");
    } catch {
      /* storage unavailable: the view just isn't remembered */
    }
  }, [turned]);
  // Fit the drawing to the room and any doorway reaching past its walls.
  const proj = useMemo(
    () => fitProjection([...roomOutline(room), ...doors.flatMap((d) => d.ring)], 1000, 40, turned),
    [room, doors, turned],
  );

  const setRect = (k: keyof RectMeasurements, v: number) =>
    setInputs((p) => {
      const m = asRect(p.room);
      return m ? { ...p, room: rectRoom({ ...m, [k]: v }) } : p;
    });

  const wall = (k: keyof RectMeasurements, label: string, title: string) =>
    rect ? (
      <EditableDim value={rect[k]} onChange={(v) => setRect(k, v)} label={label} title={title} />
    ) : (
      <div />
    );
  const near = wall("widthNear", "near", "Near wall length (door)");
  const far = wall("widthFar", "far", "Far wall length");
  const left = wall("lengthLeft", "left", "Left wall length");
  const right = wall("lengthRight", "right", "Right wall length");

  return (
    <div
      className="grid items-center justify-items-center gap-1"
      style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}
    >
      {/* top: the expansion gap (in the corner, clear of the drawing) · a wall · turn */}
      <EditableDim
        value={gap.near}
        onChange={(v) => setInputs((p) => ({ ...p, gap: uniformGap(v) }))}
        label="gap"
        tone={gapWarn ? "red" : "default"}
        step={1}
        widthCh={2}
        title={
          gapWarn
            ? "Expansion gap (all walls) — below the recommended minimum"
            : "Expansion gap (all walls)"
        }
      />
      {turned ? near : far}
      {/* The cell stays when the button is hidden in print, so nothing shifts. */}
      <div>
        <button
          type="button"
          onClick={() => setTurned((t) => !t)}
          aria-pressed={turned}
          title="Turn the drawing half a turn"
          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 print:hidden"
        >
          ↻ Turn 180°
        </button>
      </div>

      {/* middle: a side wall · plan · the other side wall */}
      {turned ? right : left}
      <div className="w-full">
        <SvgPlan
          plan={plan}
          pieces={pieces}
          room={room}
          doors={doors.map((d) => d.ring)}
          proj={proj}
        />
      </div>
      {turned ? left : right}

      {/* bottom: the remaining wall */}
      <div />
      {turned ? far : near}
      <div />
    </div>
  );
}
