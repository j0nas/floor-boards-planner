import { type ReactNode, useMemo } from "react";
import type { Inputs } from "../../domain/index.ts";
import { EditableDim } from "./EditableDim.tsx";

interface Props {
  inputs: Inputs;
  setInputs: (updater: (prev: Inputs) => Inputs) => void;
}

const SVG_W = 320;
const SVG_H = 140;
const PAD_L = 34; // left breathing room
const RIGHT_RESERVE = 64; // room for the thickness chip on the right
const FIT_W = SVG_W - PAD_L - RIGHT_RESERVE;
const FIT_H = 70; // max projected depth before thickness extrusion

// Depth axis recedes up-and-right at this angle (a 3/4 "looking down" view).
const DEPTH = (38 * Math.PI) / 180;
const DCOS = Math.cos(DEPTH);
const DSIN = Math.sin(DEPTH);

type Pt = readonly [number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const str = (pts: Pt[]) => pts.map((p) => `${p[0]},${p[1]}`).join(" ");

/**
 * Project a plank (length × width × thickness) into a shaded 3/4 box.
 * Length and width keep their true ratio (the plank's real proportions);
 * thickness is drawn with its own visible scale — a few millimetres would
 * otherwise vanish next to a two-metre board — so it reads but stays honest in
 * direction (a thicker board has a visibly taller edge).
 */
function geom(length: number, width: number, thickness: number) {
  const L = Math.max(length, 1);
  const W = Math.max(width, 1);
  const fpW = L + W * DCOS; // footprint width in model units
  const fpH = W * DSIN; // footprint depth, projected
  const s = Math.min(FIT_W / fpW, FIT_H / fpH); // honest scale for L and W
  const thick = clamp(thickness * 1.6, 7, 30); // visible thickness, in px

  const drawH = fpH * s + thick;
  const top0 = (SVG_H - drawH) / 2;

  // Top-face point for plank coords (l along length, w along width).
  const top = (l: number, w: number): Pt => [
    PAD_L + (l + w * DCOS) * s,
    top0 + (fpH - w * DSIN) * s,
  ];
  const down = (p: Pt): Pt => [p[0], p[1] + thick];

  const A = top(0, 0); // front-left
  const B = top(L, 0); // front-right
  const C = top(L, W); // back-right
  const D = top(0, W); // back-left
  const Bd = down(B);
  const Cd = down(C);
  const Ad = down(A);

  return {
    topFace: [A, B, C, D] as Pt[],
    frontFace: [A, B, Bd, Ad] as Pt[],
    endFace: [B, C, Cd, Bd] as Pt[],
    bevel: [top(0, W * 0.16), top(L, W * 0.16)] as Pt[], // faint micro-bevel line
    lengthAt: mid(Ad, Bd),
    widthAt: mid(A, D),
    thickAt: mid(C, Cd),
  };
}

function Chip({
  at,
  dx = 0,
  dy = 0,
  anchor,
  children,
}: {
  at: Pt;
  dx?: number;
  dy?: number;
  anchor: string;
  children: ReactNode;
}) {
  return (
    <div className="absolute" style={{ left: at[0] + dx, top: at[1] + dy, transform: anchor }}>
      {children}
    </div>
  );
}

/** A single board drawn as an editable 3D plank — change any dimension in place. */
export function BoardDiagram({ inputs, setInputs }: Props) {
  const { board } = inputs;
  const setBoard = (k: keyof Inputs["board"], v: number) =>
    setInputs((p) => ({ ...p, board: { ...p.board, [k]: v } }));

  const g = useMemo(
    () => geom(board.length, board.width, board.thickness ?? 8),
    [board.length, board.width, board.thickness],
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Board</h3>
        <p className="text-[11px] leading-snug text-slate-400">
          Coverage face — measure the exposed plank, excluding the tongue &amp; groove.
        </p>
      </div>
      <div className="relative mx-auto" style={{ width: SVG_W, height: SVG_H }}>
        <svg
          width={SVG_W}
          height={SVG_H}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="block max-w-full"
          aria-hidden
        >
          {/* sides first (shaded darker), lit top face last */}
          <polygon
            points={str(g.endFace)}
            fill="#38bdf8"
            stroke="#1e293b"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          <polygon
            points={str(g.frontFace)}
            fill="#7dd3fc"
            stroke="#1e293b"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          <polygon
            points={str(g.topFace)}
            fill="#bae6fd"
            stroke="#1e293b"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          <line
            x1={g.bevel[0]![0]}
            y1={g.bevel[0]![1]}
            x2={g.bevel[1]![0]}
            y2={g.bevel[1]![1]}
            stroke="#1e293b"
            strokeOpacity={0.18}
            strokeWidth={1}
          />
        </svg>

        {/* dimension chips, each sitting on its own edge of the plank */}
        <Chip at={g.lengthAt} dy={10} anchor="translate(-50%,0)">
          <EditableDim
            value={board.length}
            onChange={(v) => setBoard("length", v)}
            label="L"
            title="Board length (coverage face)"
          />
        </Chip>
        <Chip at={g.widthAt} dy={-6} anchor="translate(-50%,-100%)">
          <EditableDim
            value={board.width}
            onChange={(v) => setBoard("width", v)}
            label="W"
            step={1}
            widthCh={3}
            title="Board width (coverage face)"
          />
        </Chip>
        <Chip at={g.thickAt} dx={10} anchor="translate(0,-50%)">
          <EditableDim
            value={board.thickness ?? 0}
            onChange={(v) => setBoard("thickness", v)}
            label="T"
            step={0.5}
            widthCh={3}
            title="Board thickness (e.g. 9.5)"
          />
        </Chip>
      </div>
    </section>
  );
}
