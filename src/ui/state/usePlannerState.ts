import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Axis,
  type Inputs,
  type Plan,
  type PlanResult,
  DEFAULT_INPUTS,
  computePlans,
  toRoomShape,
} from "../../domain/index.ts";

const STORAGE_KEY = "floor-planner:inputs:v1";

export interface ViewSelection {
  /** Override the auto-chosen orientation for display. */
  axis?: Axis;
  /** Override which layout option (balanced/unbalanced) is shown. */
  optionIndex?: number;
}

function loadInputs(): Inputs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Inputs;
      // Back-compat: older saves store the room as four edge measurements.
      return {
        ...DEFAULT_INPUTS,
        ...parsed,
        room: toRoomShape((parsed as { room?: unknown }).room, DEFAULT_INPUTS.room),
      };
    }
  } catch {
    /* ignore malformed storage */
  }
  return DEFAULT_INPUTS;
}

export interface PlannerState {
  inputs: Inputs;
  setInputs: (updater: (prev: Inputs) => Inputs) => void;
  resetInputs: () => void;
  loadProject: (i: Inputs) => void;
  result: PlanResult;
  view: ViewSelection;
  setView: (v: ViewSelection) => void;
  /** The plan currently shown (after any orientation override). */
  activePlan: Plan | null;
  /** Index of the layout option currently shown. */
  activeOptionIndex: number;
}

export function usePlannerState(): PlannerState {
  const [inputs, setInputsState] = useState<Inputs>(loadInputs);
  const [view, setView] = useState<ViewSelection>({});

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    } catch {
      /* ignore quota errors */
    }
  }, [inputs]);

  const setInputs = useCallback((updater: (prev: Inputs) => Inputs) => {
    setInputsState((prev) => updater(prev));
  }, []);

  const resetInputs = useCallback(() => {
    setInputsState(DEFAULT_INPUTS);
    setView({});
  }, []);

  const loadProject = useCallback((i: Inputs) => {
    setInputsState(i);
    setView({});
  }, []);

  const result = useMemo(() => computePlans(inputs), [inputs]);

  const activeAxis = view.axis ?? result.chosenAxis;
  const activePlan = result.plans[activeAxis] ?? result.plans[result.chosenAxis];
  const activeOptionIndex =
    view.optionIndex ?? activePlan?.chosenOptionIndex ?? 0;

  return {
    inputs,
    setInputs,
    resetInputs,
    loadProject,
    result,
    view,
    setView,
    activePlan,
    activeOptionIndex,
  };
}
