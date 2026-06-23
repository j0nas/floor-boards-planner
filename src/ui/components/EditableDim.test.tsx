// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { EditableDim } from "./EditableDim.tsx";

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof EditableDim>[0]> = {}) {
  const onChange = vi.fn();
  render(<EditableDim value={100} step={10} onChange={onChange} title="dim" {...props} />);
  const input = screen.getByLabelText("dim");
  fireEvent.focus(input); // hold local text so it isn't reset between key presses
  return { input, onChange };
}

test("ArrowUp / ArrowDown increment and decrement by step", () => {
  const { input, onChange } = setup();
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(onChange).toHaveBeenLastCalledWith(110);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(onChange).toHaveBeenLastCalledWith(100);
});

test("Shift multiplies the step by 10", () => {
  const { input, onChange } = setup();
  fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
  expect(onChange).toHaveBeenLastCalledWith(200);
});

test("decrement clamps at the minimum", () => {
  const { input, onChange } = setup({ value: 5, min: 1, step: 10 });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(onChange).toHaveBeenLastCalledWith(1);
});

test("typing still updates the value", () => {
  const { input, onChange } = setup();
  fireEvent.change(input, { target: { value: "250" } });
  expect(onChange).toHaveBeenLastCalledWith(250);
});
