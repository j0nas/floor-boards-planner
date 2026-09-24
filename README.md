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
pnpm test         # vp test --run (bundled Vitest) — domain + UI unit tests
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

| Module          | Responsibility                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geometry.ts`   | Exact usable floor: each wall inset by its own gap; per-row run length (slanted row-end wall) and cross width (slanted side wall → taper)             |
| `balance.ts`    | Border balancing — split a sliver leftover into two end rows `(leftover+bw)/2`; with a taper, keep the last row within a board and ≥ min at both ends |
| `leastWaste.ts` | The default pattern: row starts chosen so offcuts chain into later rows — the fewest boards, never more than the even schedule, no joint ladders      |
| `stagger.ts`    | The "even" pattern: P-phase offset schedule (~⅓ board) over each row's own length; **near-multiple-trap** rescue; stagger on real seams               |
| `cutting.ts`    | End-aware cutting-stock: one board gives at most one start and one end piece (click-joint ends), paired by maximum matching; kerf; laying-order ids   |
| `taper.ts`      | Out-of-square last-row trapezoid; verifies the gap is held and the narrow end ≥ min row                                                               |
| `waste.ts`      | Boards, packs, honest waste % (against board area), safe purchase recommendation minus on-hand                                                        |
| `compare.ts`    | Lexicographic orientation choice: valid → stagger → balance → waste                                                                                   |
| `plan.ts`       | Orchestrator: geometry → balance → stagger → pieces clipped to the floor → cut → material → score                                                     |
| `polyLayout.ts` | Custom shapes (and quads too slanted for one taper row): rows clipped to the outline, same stagger/cutting rules                                      |
| `openings.ts`   | Door openings: the floor runs through the wall to a threshold; rows passing a door reach in (notched at a jamb), or a doorway strip is added          |
| `verify.ts`     | Independent self-check of a finished plan (tiling, sizes, cuttable cut list, stagger) — shown in the UI and fuzzed in tests                           |

### Key correctness decisions

- **Every plan is independently verified.** `checkPlan` rebuilds the usable
  floor its own way and checks the pieces tile it exactly (no overlap, nothing
  in the expansion gap), every stated cut matches its drawn piece, every board's
  pieces fit it, and no board is asked for two start or two end pieces. The UI
  shows the result above the cut list; the test suite fuzzes it over randomised
  rooms, both engines and every border option.
- **Measurements are followed exactly.** A slanted wall at the row ends gives
  every row its own length (end pieces cut at a slight angle, both edges listed);
  a slanted side wall tapers the last row (width at both ends listed). Nothing is
  averaged, so the configured gap holds along every wall. The near-left corner
  is assumed square.
- **Offcuts respect the click-joint ends.** A cut start piece must keep the end
  that joins the next board and a cut end piece the opposite end, so the offcut
  from a row's end starts another row — never a second start. Reuse is
  length-only by design (cut to length first, then rip).
- **Door openings are floored to the threshold.** A door in a wall along the
  rows gets a strip of its own, clicked onto the row beside it (warned if that
  row's edge was ripped off); a door at the row ends makes the rows passing it
  reach in, notched at a jamb. Only rows passing the clear opening reach in —
  the strip under an undercut frame is covered where a doorway piece reaches it,
  never by a fragile tab. Adding a door leaves the room's own rows unchanged.
- **Fewest boards by default.** Cutting pieces onto boards is optimal for the
  pieces it gets, so waste is decided earlier, by where each row starts. The
  default "least waste" pattern searches row starts (beam search over the rows,
  tracking open offcuts, finalists scored by the real cutting pass) so the
  offcut of one row's end starts a later row. It never needs more boards than
  the regular ⅓-board "even" pattern — which it keeps when that is as good —
  holds the minimum stagger and piece length, and avoids joints lining up two
  rows apart when that costs no board. The quad engine only; custom shapes keep
  their per-row search.
- **Stagger is validated on the real seam positions** (cumulative piece sums),
  not on the generating offsets.
- **Near-multiple trap:** when the run length is close to an integer multiple of
  the board, a simple two-piece pattern can only shift the seam within a tiny
  window. The planner detects this and escalates to a multi-phase pattern that
  staggers properly, and explains why (visible by default in the 4×3 m room).
- **Waste is computed against board area** (board count × board area), capturing
  kerf and rip losses — never against summed piece areas.

## Tooling note

- **Versions:** `vite-plus` is pinned in the pnpm catalog
  (`pnpm-workspace.yaml`), with `vite` aliased to
  `@voidzero-dev/vite-plus-core` at the **same** version (plus a `vite@*`
  override so plugins share that one Vite). Upgrade both together with
  `vp migrate`, which re-pins them to the version of the `vp` running it, then
  `vp install`.
- **Tests** run on the Vitest bundled with `vite-plus`: config is the `test`
  block in `vite.config.ts`, and test files import from `vite-plus/test`.
  There is deliberately no standalone `vitest` dependency or
  `vitest.config.ts`: a second Vitest copy splits runner state
  (`describe`/`expect`/mocks).
- **Global vs local `vp`:** `pnpm test` / `pnpm build` / `pnpm exec vp …`
  always use the project's own `vite-plus`. The standalone global `vp`
  (`curl -fsSL https://vite.plus | bash`) forwards `vp dev`/`build`/`test` to
  that local package too. A `vp` installed as the **npm package** (e.g. mise
  `npm:vite-plus`) does not: it runs its own bundled tools, including for
  `vpr`/`vp run` scripts. Its `vp dev`/`build` then require its version to
  equal the pinned one, and its `vp test` can't work here (its Vitest and the
  project's are separate copies, and it can't resolve the project's `jsdom`).
  With that setup, use `pnpm test`.
