import { useMemo } from "react";
import {
  type Inputs,
  type Piece,
  type Plan,
  type RectMeasurements,
  asRect,
  rectRoom,
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

/**
 * The plan IS the interface: for a rectangular/quad room the four measurements
 * are editable chips framing the drawing (each on the wall it measures), and the
 * expansion gap is an editable chip on the red gap ring. Edit anything and the
 * floor redraws. (Multi-wall outlines are edited in the polygon editor instead.)
 */
export function PlanCanvas({ inputs, setInputs, plan, pieces, gapWarn }: Props) {
  const { room, gap } = inputs;
  const rect = asRect(room);
  const proj = useMemo(() => fitProjection([...roomOutline(room)], 1000, 40), [room]);

  const setRect = (k: keyof RectMeasurements, v: number) =>
    setInputs((p) => {
      const m = asRect(p.room);
      return m ? { ...p, room: rectRoom({ ...m, [k]: v }) } : p;
    });

  return (
    <div
      className="grid items-center justify-items-center gap-1"
      style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}
    >
      {/* top: far wall width */}
      <div />
      {rect ? (
        <EditableDim
          value={rect.widthFar}
          onChange={(v) => setRect("widthFar", v)}
          label="far"
          title="Far wall length (top)"
        />
      ) : (
        <div />
      )}
      <div />

      {/* middle: left length · plan · right length */}
      {rect ? (
        <EditableDim
          value={rect.lengthLeft}
          onChange={(v) => setRect("lengthLeft", v)}
          label="left"
          title="Left wall length"
        />
      ) : (
        <div />
      )}
      <div className="relative w-full">
        <SvgPlan plan={plan} pieces={pieces} room={room} proj={proj} />
        <div className="absolute left-2 top-2">
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
        </div>
      </div>
      {rect ? (
        <EditableDim
          value={rect.lengthRight}
          onChange={(v) => setRect("lengthRight", v)}
          label="right"
          title="Right wall length"
        />
      ) : (
        <div />
      )}

      {/* bottom: near wall width */}
      <div />
      {rect ? (
        <EditableDim
          value={rect.widthNear}
          onChange={(v) => setRect("widthNear", v)}
          label="near"
          title="Near wall length (door)"
        />
      ) : (
        <div />
      )}
      <div />
    </div>
  );
}
