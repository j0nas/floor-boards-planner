import {
  type Piece,
  type Plan,
  type Point,
  type RoomShape,
  roomOutline,
} from "../../domain/index.ts";
import { rowLabel } from "../exports.ts";
import { type Projection, centroidPx, polyToPoints } from "../svg/projection.ts";

interface Props {
  plan: Plan;
  pieces: Piece[];
  room: RoomShape;
  /** Door openings (room mm) the floor runs into, drawn under the pieces. */
  doors?: readonly (readonly Point[])[];
  proj: Projection;
}

const FILL: Record<Piece["kind"], string> = {
  full: "#bae6fd", // sky-200
  "cut-length": "#fde68a", // amber-200
  taper: "#ddd6fe", // violet-200
};

const SLIVER_STROKE = "#dc2626"; // red-600 — outlines pieces below the minimum

function fmt(n: number): string {
  return Math.round(n).toString();
}

/** "length×width", with both edges of an angled end and both ends of a taper (start→far). */
function sizeLabel(p: Piece): string {
  if (p.doorTab) {
    const { ripStart, ripEnd } = p.doorTab;
    const rip = fmt(ripStart) === fmt(ripEnd) ? fmt(ripStart) : `${fmt(ripStart)}→${fmt(ripEnd)}`;
    const len =
      p.faceLengthShort === undefined
        ? fmt(p.faceLength)
        : `${fmt(p.faceLength)}/${fmt(p.faceLengthShort)}`;
    return `${len}×${rip} (${fmt(p.faceWidth)} at door)`;
  }
  const len =
    p.faceLengthShort === undefined
      ? fmt(p.faceLength)
      : `${fmt(p.faceLength)}/${fmt(p.faceLengthShort)}`;
  const wid =
    p.faceWidthNarrow === undefined
      ? fmt(p.faceWidth)
      : p.narrowAtEnd
        ? `${fmt(p.faceWidth)}→${fmt(p.faceWidthNarrow)}`
        : `${fmt(p.faceWidthNarrow)}→${fmt(p.faceWidth)}`;
  return `${len}×${wid}`;
}

export function SvgPlan({ plan, pieces, room, doors = [], proj }: Props) {
  const roomPts = polyToPoints(roomOutline(room), proj);

  const labelFits = (p: Piece) => proj.px(p.faceLength) > 60 && proj.px(p.faceWidth) > 16;
  // Each piece is named as in the cut list (r3 #1, door 1 #1) with the board it
  // comes from, so a cut piece can be marked and its offcut matched up later.
  const cutById = new Map(plan.cutList.map((c) => [c.pieceId, c]));
  const nameOf = (p: Piece) => {
    const c = cutById.get(p.id);
    if (!c) return null;
    const row = rowLabel(plan, c);
    return {
      ref: `${row.startsWith("door") ? row : `r${row}`} #${c.indexInRow + 1}`,
      board: c.source,
      offcut: c.reused,
    };
  };

  return (
    <svg
      viewBox={proj.viewBox}
      width={proj.width}
      height={proj.height}
      className="block h-auto w-full max-w-full rounded-lg border border-slate-200 bg-white"
      role="img"
      aria-label="Scaled top-down floor plan"
    >
      <defs>
        <pattern
          id="ripHatch"
          width="6"
          height="6"
          patternTransform="rotate(45)"
          patternUnits="userSpaceOnUse"
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke="#1e293b" strokeWidth="1.2" opacity="0.55" />
        </pattern>
        <pattern
          id="sliverHatch"
          width="5"
          height="5"
          patternTransform="rotate(-45)"
          patternUnits="userSpaceOnUse"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="5"
            stroke={SLIVER_STROKE}
            strokeWidth="1.4"
            opacity="0.7"
          />
        </pattern>
      </defs>

      {/* Expansion-gap ring drawn in red; boards are drawn on top, leaving only
          the thin perimeter gap showing. */}
      <polygon points={roomPts} fill="#f87171" stroke="#334155" strokeWidth={2.5} />
      {/* Doorways: the floor runs through the wall to a threshold under the door. */}
      {doors.map((d, i) => (
        <polygon
          key={`door${i}`}
          points={polyToPoints(d, proj)}
          fill="#f87171"
          stroke="#334155"
          strokeWidth={1.2}
          strokeDasharray="4 3"
        />
      ))}

      {pieces.map((p) => {
        const pts = polyToPoints(p.poly, proj);
        const c = centroidPx(p.poly, proj);
        const sliver = p.undersized === true;
        const name = nameOf(p);
        // Name and size on two lines where the piece is tall enough; otherwise
        // the name alone (it's what you mark on the board), and the size on hover.
        const fits = labelFits(p);
        const twoLines = fits && proj.px(p.faceWidth) > 34;
        const tip = `${name ? `${name.ref} · ${name.board}: ` : ""}${sizeLabel(p)} mm (${p.kind}${sliver ? " — below min" : ""})`;
        return (
          <g key={p.id}>
            <polygon
              points={pts}
              fill={FILL[p.kind]}
              stroke={sliver ? SLIVER_STROKE : "#475569"}
              strokeWidth={sliver ? 1.8 : 0.7}
            />
            {p.isRipped ? <polygon points={pts} fill="url(#ripHatch)" stroke="none" /> : null}
            {sliver ? <polygon points={pts} fill="url(#sliverHatch)" stroke="none" /> : null}
            <title>{tip}</title>
            {fits ? (
              <text
                x={c.x}
                y={twoLines ? c.y - 8 : c.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={twoLines ? 14 : 13}
                fill="#0f172a"
                className="pointer-events-none select-none"
              >
                {name ? (
                  <>
                    <tspan fontWeight={600}>{name.ref}</tspan>
                    {" · "}
                    <tspan fontWeight={600} fill={name.offcut ? "#047857" : "#0f172a"}>
                      {name.board}
                    </tspan>
                  </>
                ) : (
                  sizeLabel(p)
                )}
              </text>
            ) : null}
            {twoLines && name ? (
              <text
                x={c.x}
                y={c.y + 9}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={12}
                fill="#334155"
                className="pointer-events-none select-none"
              >
                {sizeLabel(p)}
              </text>
            ) : null}
          </g>
        );
      })}

      {plan.taper ? (
        <text
          x={proj.width / 2}
          y={proj.height - 10}
          textAnchor="middle"
          fontSize={11}
          fill="#7c3aed"
          className="pointer-events-none"
        >
          {`taper: last row ${fmt(plan.taper.taperWideMm)} → ${fmt(plan.taper.taperNarrowMm)} mm, gap held ${fmt(plan.taper.tightGapMm)} mm`}
        </text>
      ) : null}
    </svg>
  );
}

export function PlanLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
      <LegendSwatch label="Full board" color={FILL.full} />
      <LegendSwatch label="Cut piece" color={FILL["cut-length"]} />
      <LegendSwatch label="Taper" color={FILL.taper} />
      <LegendSwatch label="Ripped row" color={FILL.full} hatch="#1e293b" />
      <LegendSwatch
        label="Below min length"
        color={FILL["cut-length"]}
        hatch={SLIVER_STROKE}
        border={SLIVER_STROKE}
      />
      <LegendSwatch label="Expansion gap" color="#f87171" />
      <span className="basis-full text-slate-500">
        Each piece is named as in the cut list — row and piece (r3 #1) and the board it's cut from
        (B2). Pieces with the same board number come from one board: mark it on both halves when you
        cut. A green number is an offcut.
      </span>
    </div>
  );
}

function LegendSwatch({
  label,
  color,
  hatch,
  border = "#475569",
}: {
  label: string;
  color: string;
  /** Hatch line colour; omit for no hatch. */
  hatch?: string;
  border?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="14" height="14" className="shrink-0">
        <rect
          width="14"
          height="14"
          fill={color}
          stroke={border}
          strokeWidth={border === "#475569" ? 0.7 : 1.4}
        />
        {hatch ? (
          <line x1="0" y1="14" x2="14" y2="0" stroke={hatch} strokeWidth="1.2" opacity="0.7" />
        ) : null}
      </svg>
      {label}
    </span>
  );
}
