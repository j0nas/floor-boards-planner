import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Axis,
  type Inputs,
  type LayoutOption,
  type Plan,
  type PlanResult,
  DEFAULT_INPUTS,
  buildPlanForAxis,
  checkPlan,
  computePlans,
  toRoomShape,
} from "../../domain/index.ts";

const STORAGE_KEY = "floor-planner:inputs:v1";

export interface ViewSelection {
  /** Override the auto-chosen orientation for display. */
  axis?: Axis;
  /**
   * Override which border layout is shown. Kept by kind, not index: the option
   * list reorders as the room changes, and an index would silently flip to the
   * other layout.
   */
  optionKind?: LayoutOption["kind"];
}

/** Rebuild a possibly older saved `Inputs`, backfilling fields added since. */
export function restoreInputs(parsed: Partial<Inputs>): Inputs {
  return {
    ...DEFAULT_INPUTS,
    ...parsed,
    board: { ...DEFAULT_INPUTS.board, ...parsed.board },
    gap: { ...DEFAULT_INPUTS.gap, ...parsed.gap },
    pack: { ...DEFAULT_INPUTS.pack, ...parsed.pack },
    tunables: { ...DEFAULT_INPUTS.tunables, ...parsed.tunables },
    // Older saves store the room as four edge measurements.
    room: toRoomShape((parsed as { room?: unknown }).room, DEFAULT_INPUTS.room),
  };
}

function loadInputs(): Inputs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return restoreInputs(JSON.parse(raw) as Partial<Inputs>);
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
  /** The plan currently shown — orientation and border layout overrides applied. */
  activePlan: Plan | null;
  /** Index of the layout option currently shown. */
  activeOptionIndex: number;
  /** Problems the independent self-check found in the shown plan (empty = sound). */
  selfCheck: string[];
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
  const basePlan = result.plans[activeAxis] ?? result.plans[result.chosenAxis];

  // A different border layout is a different plan — pieces, cut list and
  // material all change — so build it in full rather than just redrawing rows.
  const activePlan = useMemo(() => {
    if (!basePlan || !view.optionKind || !basePlan.rows.length) return basePlan;
    const idx = basePlan.layoutOptions.findIndex((o) => o.kind === view.optionKind);
    if (idx < 0 || idx === basePlan.chosenOptionIndex) return basePlan;
    return buildPlanForAxis(inputs, basePlan.runAxis, idx);
  }, [basePlan, view.optionKind, inputs]);

  const selfCheck = useMemo(
    () => (activePlan ? checkPlan(inputs, activePlan) : []),
    [activePlan, inputs],
  );

  return {
    inputs,
    setInputs,
    resetInputs,
    loadProject,
    result,
    view,
    setView,
    activePlan,
    activeOptionIndex: activePlan?.chosenOptionIndex ?? 0,
    selfCheck,
  };
}
