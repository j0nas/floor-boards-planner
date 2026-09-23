import { type Inputs, type Opening, isQuadRoom, wallLength } from "../../domain/index.ts";
import { NumberField } from "./NumberField.tsx";

interface Props {
  inputs: Inputs;
  setInputs: (updater: (prev: Inputs) => Inputs) => void;
}

const QUAD_WALLS = ["Near wall (bottom)", "Right wall", "Far wall (top)", "Left wall"];

/**
 * The domain measures an opening from its wall's start corner (outline order).
 * On a four-wall room that is the right end of the far wall and the far end of
 * the left wall, so those two are flipped to read "from the left" / "from the
 * near end", the way the plan is drawn.
 */
function flipped(inputs: Inputs, wall: number): boolean {
  return isQuadRoom(inputs.room) && (wall === 2 || wall === 3);
}

function fromLabel(inputs: Inputs, wall: number): string {
  if (!isQuadRoom(inputs.room)) return `From corner ${wall + 1}`;
  return wall % 2 === 0 ? "From the left" : "From the near end";
}

/** Door openings the floor runs into, each up to a threshold under the door. */
export function OpeningsEditor({ inputs, setInputs }: Props) {
  const openings = inputs.openings ?? [];
  const walls = inputs.room.outline.length;
  const wallName = (i: number) => (isQuadRoom(inputs.room) ? QUAD_WALLS[i] : `Wall ${i + 1}`);

  const update = (k: number, patch: (o: Opening, len: number) => Opening) =>
    setInputs((p) => ({
      ...p,
      openings: (p.openings ?? []).map((o, j) => (j === k ? patch(o, wallLength(p, o.wall)) : o)),
    }));
  // Where the user reads the position from, whichever corner the wall starts at.
  const shown = (o: Opening, len: number) =>
    flipped(inputs, o.wall) ? len - o.offset - o.width : o.offset;
  const placed = (o: Opening, len: number, at: number, width = o.width) =>
    flipped(inputs, o.wall) ? len - at - width : at;

  const add = () =>
    setInputs((p) => {
      const len = wallLength(p, 0);
      const width = Math.min(800, Math.max(100, len - 200));
      const door: Opening = {
        wall: 0,
        offset: Math.max(0, (len - width) / 2),
        width,
        depth: 60,
        tuck: 10,
      };
      return { ...p, openings: [...(p.openings ?? []), door] };
    });
  const remove = (k: number) =>
    setInputs((p) => ({ ...p, openings: (p.openings ?? []).filter((_, j) => j !== k) }));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] leading-snug text-slate-400">
        Where the floor carries on through a doorway to a threshold under the door. Width is the
        clear opening between the door frame; depth is how far past the wall's face the floor runs;
        under frame is how far it slides under the (undercut) frame on each side.
      </p>
      {openings.map((o, k) => {
        const len = wallLength(inputs, o.wall);
        return (
          <div key={k} className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
            <div className="flex items-center justify-between gap-2">
              <select
                aria-label={`Door ${k + 1} wall`}
                value={o.wall}
                onChange={(e) => {
                  const wall = Number(e.target.value);
                  update(k, (d) => ({
                    ...d,
                    wall,
                    offset: Math.min(d.offset, Math.max(0, wallLength(inputs, wall) - d.width)),
                  }));
                }}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
              >
                {Array.from({ length: walls }, (_, i) => (
                  <option key={i} value={i}>
                    Door {k + 1}: {wallName(i)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => remove(k)}
                className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label={fromLabel(inputs, o.wall)}
                value={Math.round(shown(o, len) * 10) / 10}
                onChange={(v) => update(k, (d, l) => ({ ...d, offset: placed(d, l, v) }))}
                hint="to the door frame"
              />
              <NumberField
                label="Width"
                value={o.width}
                onChange={(v) =>
                  update(k, (d, l) => ({ ...d, width: v, offset: placed(d, l, shown(d, l), v) }))
                }
                hint="clear opening"
              />
              <NumberField
                label="Depth"
                value={o.depth}
                onChange={(v) => update(k, (d) => ({ ...d, depth: v }))}
                hint="past the wall's face"
              />
              <NumberField
                label="Under frame"
                value={o.tuck}
                onChange={(v) => update(k, (d) => ({ ...d, tuck: v }))}
                hint="each side"
              />
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="self-start rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
      >
        + Add door opening
      </button>
    </div>
  );
}
