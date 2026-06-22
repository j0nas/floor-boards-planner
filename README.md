# Laminate Floor Layout Planner

An interactive planner that, given a room's dimensions and the flooring board
dimensions, computes and visualises the optimal way to lay a floating
click-laminate floor — the row layout, the staggered cutting pattern, offcut
reuse, and the resulting material/waste. Every input recalculates the plan, cut
list, and material estimate live.

> Built with React + TypeScript + Tailwind on Vite+ (`vp`). The flooring logic
> is a pure, deterministic, fully unit-tested domain layer with no UI coupling.

## Run it

```bash
pnpm install
pnpm dev          # vp dev — open the printed localhost URL
pnpm test         # vitest — domain + UI unit tests
pnpm build        # tsc + vp build → dist/
pnpm typecheck    # tsc --noEmit
```

## What it does

- **Inputs:** room width/length measured at **both ends** of each axis (to
  detect out-of-square walls), board length/width/thickness, per-wall expansion
  gap, board orientation (auto-recommended or forced), pack size + boards on
  hand, and advanced tunables (min row width, min piece, min/ideal stagger,
  kerf, square tolerance, min taper gap, safety margin). Ships with realistic
  defaults (≈2050×211 mm board, 6-board/2.6 m² pack, 10 mm gap, 4×3 m room).
- **Outputs:** a scaled top-down SVG plan (every piece drawn and labelled, full
  vs cut distinguished, ripped rows hatched, taper shown, expansion gap as a
  ring), an orientation comparison, a material summary (boards, packs, waste %,
  recommended purchase with safety margin and dye-lot note), and a cut list with
  the offcut-reuse map.
- **Exports:** print-friendly page, CSV cut list, and save/load project as JSON.

## Domain model (`src/domain/`)

Pure functions, no React/DOM, no randomness. `computePlans(inputs)` runs both
orientations and chooses the better one (unless forced).

| Module | Responsibility |
| --- | --- |
| `geometry.ts` | Fixed room frame; run length & cross-width (with linear taper) per orientation |
| `balance.ts` | Border balancing — split a sliver leftover into two equal end rows `(leftover+bw)/2`; surface balanced/unbalanced options |
| `stagger.ts` | P-phase offset schedule (~⅓ board); **near-multiple-trap** detection and multi-piece rescue; stagger validated on actual seam positions |
| `cutting.ts` | 1-D cutting-stock with best-fit offcut reuse + complementary pairing + kerf; reuse map |
| `taper.ts` | Out-of-square last-row trapezoid; verifies the gap is held and the narrow end ≥ min row |
| `waste.ts` | Boards, packs, honest waste % (against board area), safe purchase recommendation minus on-hand |
| `compare.ts` | Lexicographic orientation choice: valid → stagger → balance → waste |
| `plan.ts` | Orchestrator: geometry → balance → stagger → materialise pieces → cut → material → score |

### Key correctness decisions

- **Stagger is validated on the real seam positions** (cumulative piece sums),
  not on the generating offsets — offcut reuse makes a row's joints non-periodic.
- **Near-multiple trap:** when the run length is close to an integer multiple of
  the board, a simple two-piece pattern can only shift the seam within a tiny
  window. The planner detects this and escalates to a multi-phase pattern that
  staggers properly, and explains why (visible by default in the 4×3 m room).
- **Waste is computed against board area** (board count × board area), capturing
  kerf and rip losses — never against summed piece areas.
- **Out-of-square is scoped to one non-parallel wall** (the common case); a
  general quadrilateral is detected and flagged to verify on site.

## Tooling note

Vite+ 0.1.x ships a `vp test` whose Vitest binary doesn't resolve under pnpm's
isolated store, and it overrides `vitest` to a CLI-less wrapper. This project
points the pnpm catalog's `vitest` at the real package and runs tests with a
dedicated `vitest.config.ts` (Vitest's own `defineConfig`, bypassing the
vite-plus wrapper). `vp dev`/`vp build`/`vp check` are unaffected.
