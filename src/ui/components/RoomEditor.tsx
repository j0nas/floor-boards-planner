import { useMemo, useRef, useState } from "react";
import { useDrag } from "@use-gesture/react";
import {
  type Inputs,
  type Point,
  insertCorner,
  moveCorner,
  rectRoom,
  removeCorner,
  roomOutline,
  roomWalls,
  selfIntersects,
  setWallLength,
} from "../../domain/index.ts";
import { type Projection, fitProjection, polyToPoints } from "../svg/projection.ts";
import { EditableDim } from "./EditableDim.tsx";

interface Props {
  inputs: Inputs;
  setInputs: (updater: (prev: Inputs) => Inputs) => void;
}

const GRID = 10; // mm snap grid
const snapGrid = (v: number) => Math.round(v / GRID) * GRID;

/** Bounding box of the outline as a canonical rectangle (for "reset to box"). */
function boundingRect(outline: readonly Point[]) {
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return rectRoom({ widthNear: w, widthFar: w, lengthLeft: h, lengthRight: h });
}

/**
 * Direct-manipulation room outline editor: drag corners to reshape, click an
 * edge's ＋ to add a wall, select a corner to remove it. Lengths and angles are
 * shown (and lengths are editable) in the perimeter-walk list below.
 */
export function RoomEditor({ inputs, setInputs }: Props) {
  const room = inputs.room;
  const outline = roomOutline(room);
  const svgRef = useRef<SVGSVGElement>(null);
  const frozen = useRef<Projection | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const liveProj = useMemo(() => fitProjection([...outline], 520, 30), [outline]);
  const proj = frozen.current ?? liveProj;

  const invalid = selfIntersects(room);
  const walls = roomWalls(room);

  // Pointer client px → room mm, via the (frozen) projection and the SVG's
  // rendered rect (so it survives the responsive CSS scaling of the canvas).
  const toMm = (clientX: number, clientY: number): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * proj.width;
    const vy = ((clientY - r.top) / r.height) * proj.height;
    return proj.toMm({ x: vx, y: vy });
  };

  // Snap a dragged corner to a neighbour's axis (keeps right angles crisp), else
  // to a coarse grid.
  const snapCorner = (p: Point, i: number): Point => {
    const n = outline.length;
    const prev = outline[(i - 1 + n) % n]!;
    const next = outline[(i + 1) % n]!;
    const tol = 28 / proj.scale; // ≈28 px, expressed in mm
    const axis = (v: number, a: number, b: number) =>
      Math.abs(v - a) < tol ? a : Math.abs(v - b) < tol ? b : snapGrid(v);
    return { x: axis(p.x, prev.x, next.x), y: axis(p.y, prev.y, next.y) };
  };

  const bindVertex = useDrag(({ args, xy: [cx, cy], first, last, event }) => {
    event.preventDefault?.();
    const i = args[0] as number;
    if (first) frozen.current = liveProj;
    const to = snapCorner(toMm(cx, cy), i);
    setInputs((p) => ({ ...p, room: moveCorner(p.room, i, to) }));
    if (last) frozen.current = null;
  });

  const addWall = (edgeIndex: number) => {
    setInputs((p) => ({ ...p, room: insertCorner(p.room, edgeIndex) }));
    setSelected(edgeIndex + 1);
  };

  const removeSelected = () => {
    if (selected === null) return;
    setInputs((p) => ({ ...p, room: removeCorner(p.room, selected) }));
    setSelected(null);
  };

  const canRemove = selected !== null && outline.length > 3;
  const r = (mm: number) => proj.px(mm);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-slate-500">
          Drag corners to reshape · click a ＋ on an edge to add a wall · select a corner to remove it.
        </p>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!canRemove}
            onClick={removeSelected}
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          >
            Remove corner
          </button>
          <button
            type="button"
            onClick={() => {
              setInputs((p) => ({ ...p, room: boundingRect(roomOutline(p.room)) }));
              setSelected(null);
            }}
            className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          >
            Reset to box
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={proj.viewBox}
        className="block h-auto w-full max-w-full touch-none rounded-lg border border-slate-200 bg-white"
        role="img"
        aria-label="Editable room outline"
      >
        <polygon
          points={polyToPoints(outline, proj)}
          fill={invalid ? "#fee2e2" : "#e0f2fe"}
          stroke={invalid ? "#ef4444" : "#0ea5e9"}
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* edge midpoint ＋ handles to add a wall */}
        {outline.map((a, i) => {
          const b = outline[(i + 1) % outline.length]!;
          const mid = proj.toPx({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          return (
            <g
              key={`e${i}`}
              className="cursor-pointer"
              onClick={() => addWall(i)}
              role="button"
              aria-label={`Add a wall on edge ${i + 1}`}
            >
              <circle cx={mid.x} cy={mid.y} r={r(70)} fill="#fff" stroke="#94a3b8" strokeWidth={1.2} />
              <line x1={mid.x - r(45)} y1={mid.y} x2={mid.x + r(45)} y2={mid.y} stroke="#64748b" strokeWidth={1.4} />
              <line x1={mid.x} y1={mid.y - r(45)} x2={mid.x} y2={mid.y + r(45)} stroke="#64748b" strokeWidth={1.4} />
            </g>
          );
        })}

        {/* draggable corner handles */}
        {outline.map((p, i) => {
          const q = proj.toPx(p);
          const isSel = selected === i;
          return (
            <circle
              key={`v${i}`}
              {...bindVertex(i)}
              cx={q.x}
              cy={q.y}
              r={r(isSel ? 130 : 110)}
              fill={isSel ? "#0284c7" : "#0ea5e9"}
              stroke="#fff"
              strokeWidth={2}
              style={{ touchAction: "none", cursor: "grab" }}
              onClick={() => setSelected(i)}
            />
          );
        })}
      </svg>

      {invalid ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
          The walls cross each other — drag a corner to fix the outline.
        </p>
      ) : null}

      {/* perimeter-walk list: editable wall lengths + corner angles */}
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">
          <span>Wall</span>
          <span>Length</span>
          <span>Corner ∠</span>
        </div>
        {walls.map((w, i) => {
          const closing = i === walls.length - 1;
          return (
            <div
              key={`w${i}`}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 text-xs text-slate-600"
            >
              <span className="tabular-nums text-slate-400">{i + 1}</span>
              {closing ? (
                <span className="tabular-nums text-slate-400">{Math.round(w.length)} mm (closes)</span>
              ) : (
                <EditableDim
                  value={w.length}
                  onChange={(v) => setInputs((p) => ({ ...p, room: setWallLength(p.room, i, v) }))}
                  label=""
                  step={10}
                  widthCh={4}
                  title={`Length of wall ${i + 1}`}
                />
              )}
              <span className="tabular-nums text-slate-500">{Math.round(w.interiorAngleDeg)}°</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
