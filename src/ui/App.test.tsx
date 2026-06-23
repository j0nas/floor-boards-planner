// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { App } from "./App.tsx";

afterEach(cleanup);

test("App renders the planner with a computed material estimate", () => {
  render(<App />);
  expect(
    screen.getByRole("heading", { name: /Laminate Floor Layout Planner/i }),
  ).toBeInTheDocument();
  // The default scenario produces a plan, so the material summary is present.
  expect(screen.getByText(/Boards needed/i)).toBeInTheDocument();
  expect(screen.getByText(/Cut list & offcut reuse/i)).toBeInTheDocument();
  // The scaled plan is drawn.
  expect(screen.getByRole("img", { name: /floor plan/i })).toBeInTheDocument();
});

test("App shows the orientation comparison table", () => {
  render(<App />);
  expect(screen.getByText(/Orientation & borders/i)).toBeInTheDocument();
  expect(screen.getAllByText(/Along width|Along length/i).length).toBeGreaterThan(0);
});
