import { type Piece, type Plan, type RoomShape, roomOutline } from "../../domain/index.ts";
import { type Projection, centroidPx, polyToPoints } from "../svg/projection.ts";

interface Props {
  plan: Plan;
  pieces: Piece[];
  room: RoomShape;
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

export function SvgPlan({ plan, pieces, room, proj }: Props) {
  const roomPts = polyToPoints(roomOutline(room), proj);

  const labelFits = (p: Piece) => proj.px(p.faceLength) > 46 && proj.px(p.faceWidth) > 16;

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

      {pieces.map((p) => {
        const pts = polyToPoints(p.poly, proj);
        const c = centroidPx(p.poly, proj);
        const sliver = p.undersized === true;
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
            {labelFits(p) ? (
              <text
                x={c.x}
                y={c.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fill="#0f172a"
                className="pointer-events-none select-none"
              >
                {p.kind === "taper"
                  ? `${fmt(p.faceLength)}×${fmt(p.faceWidth)}→${fmt(p.faceWidthNarrow ?? p.faceWidth)}`
                  : `${fmt(p.faceLength)}×${fmt(p.faceWidth)}`}
              </text>
            ) : (
              <title>{`${fmt(p.faceLength)} × ${fmt(p.faceWidth)} mm (${p.kind}${sliver ? " — below min" : ""})`}</title>
            )}
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
