import type {
  Board,
  Citation,
  Diagnostic,
  ExpansionGap,
  Inputs,
  Pack,
  RectMeasurements,
} from "./types.ts";
import { MAX_FLOATING_SPAN_MM, recommendedMinGap } from "./defaults.ts";
import { asRect, roomArea } from "./room.ts";
import { type Mm, gt, lt } from "./units.ts";

/**
 * Sources backing the expansion-gap guidance (Norway). The manufacturer baseline
 * is ~5 mm (Pergo: 3 mm in dry winter air, up to 8 mm in humid conditions);
 * 8–10 mm is the common retailer recommendation, and larger floors need
 * proportionally wider gaps.
 */
const GAP_SOURCES: readonly Citation[] = [
  {
    label:
      "Pergo (manufacturer, NO): ~5 mm baseline clearance — 3 mm in dry winter air, 8 mm in humid conditions",
    url: "https://www.megaflis.no/globalassets/productimages/5401013674656_mon.pdf",
  },
  {
    label:
      "OBS BYGG — Leggeanvisning laminatgulv: 8–10 mm to walls, max ~10 × 10 m without an expansion joint",
    url: "https://www.obsbygg.no/globalassets/productdocumentsfolder2/688621_3423128631586_.pdf",
  },
  {
    label: "ByggeBolig (NO): ~4–5 mm works in practice and is covered by standard skirting",
    url: "https://www.byggebolig.no/gulv/klaring-mellom-laminatgulv-og-vegg-ekspansjonsfuge",
  },
] as const;

/** Sources for the large-span intermediate expansion-joint guidance. */
const SPAN_SOURCES: readonly Citation[] = [
  {
    label: "Quick-Step (manufacturer): max floor length without an expansion joint",
    url: "https://www.quick-step.co.uk/en-gb/frequently-asked-questions/laminate/preparation-and-installation/what-is-the-maximum-floor-length-i-can-install-without-expansion-gap",
  },
  {
    label: "Swiss Krono (manufacturer): expansion joints",
    url: "https://www.swisskrono.com/de-en/products/flooring/laminate-guide/expansion-joints/",
  },
] as const;

/** Resolve boards-per-pack from explicit count or area/pack ÷ board area. */
export function resolveBoardsPerPack(pack: Pack, board: Board): number {
  if (pack.boardsPerPack && pack.boardsPerPack > 0) return pack.boardsPerPack;
  if (pack.areaPerPack && pack.areaPerPack > 0) {
    const boardArea = board.length * board.width;
    if (boardArea > 0) return Math.max(1, Math.round(pack.areaPerPack / boardArea));
  }
  return 1;
}

function err(code: string, message: string): Diagnostic {
  return { severity: "error", code, message };
}
function warn(code: string, message: string, sources?: readonly Citation[]): Diagnostic {
  return sources
    ? { severity: "warn", code, message, sources }
    : { severity: "warn", code, message };
}

/** Maximum quad span (for gap sizing warnings). */
function maxSpan(m: RectMeasurements): Mm {
  return Math.max(m.widthNear, m.widthFar, m.lengthLeft, m.lengthRight);
}

/** Per-wall expansion-gap sizing and the single-span warning (quad rooms only). */
function quadGapDiagnostics(rect: RectMeasurements, gap: ExpansionGap): Diagnostic[] {
  const d: Diagnostic[] = [];
  const lengthSpan = Math.max(rect.lengthLeft, rect.lengthRight);
  const widthSpan = Math.max(rect.widthNear, rect.widthFar);
  const gapChecks = [
    ["near", gap.near, lengthSpan],
    ["far", gap.far, lengthSpan],
    ["left", gap.left, widthSpan],
    ["right", gap.right, widthSpan],
  ] as const;
  // The gap is usually a single value, so collapse identical findings into one
  // message — only naming walls when the per-wall gaps actually differ.
  const wallSuffix = (walls: string[]) => (walls.length === 4 ? "" : ` (${walls.join(", ")})`);

  const negativeWalls = gapChecks.filter(([, v]) => v < 0).map(([name]) => name);
  if (negativeWalls.length) {
    d.push(err("gap.negative", `Expansion gap${wallSuffix(negativeWalls)} cannot be negative.`));
  }

  // Gaps so large they swallow the room: opposite-wall gaps must leave usable
  // floor, else geometry collapses to nothing with no other explanation.
  const lengthMin = Math.min(rect.lengthLeft, rect.lengthRight);
  const widthMin = Math.min(rect.widthNear, rect.widthFar);
  if (gap.near + gap.far >= lengthMin) {
    d.push(
      err(
        "gap.exceedsRoom",
        `Near + far expansion gaps (${gap.near} + ${gap.far} mm) leave no floor along the ${Math.round(lengthMin)} mm length.`,
      ),
    );
  }
  if (gap.left + gap.right >= widthMin) {
    d.push(
      err(
        "gap.exceedsRoom",
        `Left + right expansion gaps (${gap.left} + ${gap.right} mm) leave no floor along the ${Math.round(widthMin)} mm width.`,
      ),
    );
  }

  const tooSmall = new Map<string, { value: Mm; recMin: Mm; walls: string[] }>();
  for (const [name, v, span] of gapChecks) {
    if (v < 0) continue;
    const recMin = recommendedMinGap(span);
    if (lt(v, recMin)) {
      const key = `${v}|${recMin}`;
      const g = tooSmall.get(key) ?? { value: v, recMin, walls: [] };
      g.walls.push(name);
      tooSmall.set(key, g);
    }
  }
  for (const g of tooSmall.values()) {
    d.push(
      warn(
        "gap.tooSmall",
        `Expansion gap${wallSuffix(g.walls)} is ${g.value} mm — below the ~${g.recMin} mm practical minimum (≈1 mm per metre of span; Pergo's baseline is ~5 mm, 8–10 mm is the usual Norwegian recommendation). Too little gap risks buckling.`,
        GAP_SOURCES,
      ),
    );
  }

  const span = maxSpan(rect);
  if (span > MAX_FLOATING_SPAN_MM) {
    d.push(
      warn(
        "span.expansionJoint",
        `A ${(span / 1000).toFixed(1)} m span exceeds the ~${MAX_FLOATING_SPAN_MM / 1000} m single-span limit for a floating floor — add an intermediate expansion joint (e.g. a T-moulding in a doorway) and use a 13–20 mm perimeter gap there.`,
        SPAN_SOURCES,
      ),
    );
  }
  return d;
}

/**
 * Validate inputs and produce input-level diagnostics. Errors here mean no
 * valid plan can be produced; warnings are surfaced but planning continues.
 */
export function validateInputs(i: Inputs): Diagnostic[] {
  const d: Diagnostic[] = [];
  const { board, tunables, room, gap } = i;
  const rect = asRect(room);

  // Room outline must be a real, non-degenerate polygon.
  if (room.outline.length < 3 || Math.abs(roomArea(room)) < 1) {
    d.push(err("room.degenerate", "The room outline must be a closed shape with positive area."));
  } else if (rect) {
    // Canonical quad: validate each measured edge.
    for (const [name, v] of [
      ["width (near)", rect.widthNear],
      ["width (far)", rect.widthFar],
      ["length (left)", rect.lengthLeft],
      ["length (right)", rect.lengthRight],
    ] as const) {
      if (v <= 0) d.push(err("room.nonpositive", `Room ${name} must be greater than 0.`));
    }
  }
  // (Custom multi-wall outlines are planned by the polygon path, which attaches
  // its own heuristic note.)
  if (board.length <= 0 || board.width <= 0) {
    d.push(err("board.nonpositive", "Board length and width must be greater than 0."));
  }

  // Piece feasibility.
  if (gt(tunables.minPiece, board.length)) {
    d.push(
      err(
        "minPiece.gtBoard",
        `Minimum piece length (${tunables.minPiece} mm) exceeds the board length (${board.length} mm); no layout is possible.`,
      ),
    );
  } else if (gt(tunables.minPiece, board.length / 2)) {
    // Above half a board, a short row leftover can't be rebalanced into the
    // neighbour without one of the two pieces dropping below the minimum.
    d.push(
      warn(
        "minPiece.gtHalfBoard",
        `Minimum piece length (${tunables.minPiece} mm) is more than half a board length (${board.length} mm); some rows may be forced to a short end piece.`,
      ),
    );
  }
  if (gt(tunables.minRowWidth, board.width)) {
    d.push(
      err(
        "minRow.gtBoard",
        `Minimum row width (${tunables.minRowWidth} mm) exceeds the board width (${board.width} mm); no layout is possible.`,
      ),
    );
  } else if (gt(tunables.minRowWidth, board.width / 2)) {
    d.push(
      warn(
        "minRow.gtHalfBoard",
        `Minimum row width (${tunables.minRowWidth} mm) is more than half a board width; border balancing may be forced to fail.`,
      ),
    );
  }

  // Stagger feasibility.
  if (gt(tunables.minStagger, board.length / 2)) {
    d.push(
      warn(
        "minStagger.large",
        `Minimum stagger (${tunables.minStagger} mm) is more than half a board length; a valid stagger may be impossible.`,
      ),
    );
  }

  // Expansion gap sizing & single-span warnings — quad rooms only for now; the
  // polygon path will size a uniform perimeter inset instead.
  if (rect) d.push(...quadGapDiagnostics(rect, gap));

  // Pack.
  if (
    (!i.pack.boardsPerPack || i.pack.boardsPerPack <= 0) &&
    (!i.pack.areaPerPack || i.pack.areaPerPack <= 0)
  ) {
    d.push(warn("pack.missing", "No pack size given; assuming 1 board per pack."));
  }
  if (i.boardsOnHand < 0) {
    d.push(err("onHand.negative", "Boards on hand cannot be negative."));
  }

  return d;
}

/** True when the diagnostics contain a hard error. */
export function hasError(d: readonly Diagnostic[]): boolean {
  return d.some((x) => x.severity === "error");
}
