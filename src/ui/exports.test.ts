import { expect, test } from "vite-plus/test";
import { DEFAULT_INPUTS, buildPlanForAxis, rectRoom } from "../domain/index.ts";
import { cutListToCsv, projectFromJson, projectToJson } from "./exports.ts";

test("CSV lists every piece with its role, board and both dimensions of an angled/taper cut", () => {
  const inputs = structuredClone(DEFAULT_INPUTS);
  inputs.room = rectRoom({ widthNear: 4000, widthFar: 4040, lengthLeft: 3100, lengthRight: 3000 });
  const plan = buildPlanForAxis(inputs, "X");
  const [header, ...lines] = cutListToCsv(plan).split("\n");
  expect(header).toBe(
    "row,piece,type,role,length_mm,length_short_edge_mm,width_mm,width_narrow_end_mm,narrow_end,board,board_shared_with,offcut_remainder_mm",
  );
  expect(lines.length).toBe(plan.cutList.length);
  const cells = lines.map((l) => l.split(","));
  expect(cells.some((c) => c[5] !== "")).toBe(true); // an angled end piece
  expect(cells.some((c) => c[7] !== "" && (c[8] === "far" || c[8] === "start"))).toBe(true); // a taper
  expect(cells.every((c) => /^B\d+$/.test(c[9]!))).toBe(true);
});

test("a saved project loads back, backfilling fields added since", () => {
  const saved = JSON.parse(projectToJson(DEFAULT_INPUTS)) as { inputs: Record<string, unknown> };
  delete saved.inputs.flip;
  delete (saved.inputs.tunables as Record<string, unknown>).staggerSeed;
  const loaded = projectFromJson(JSON.stringify(saved));
  expect(loaded.flip).toBe(false);
  expect(loaded.tunables.staggerSeed).toBe(DEFAULT_INPUTS.tunables.staggerSeed);
  expect(loaded.room).toEqual(DEFAULT_INPUTS.room);
});
