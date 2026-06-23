import { useMemo, useRef } from "react";
import { piecesForOption } from "../domain/index.ts";
import { BoardDiagram } from "./components/BoardDiagram.tsx";
import { CutListTable } from "./components/CutListTable.tsx";
import { DiagnosticsBanner } from "./components/DiagnosticsBanner.tsx";
import { InputsPanel } from "./components/InputsPanel.tsx";
import { MaterialSummary } from "./components/MaterialSummary.tsx";
import { OrientationCompare } from "./components/OrientationCompare.tsx";
import { PlanCanvas } from "./components/PlanCanvas.tsx";
import { PlanLegend } from "./components/SvgPlan.tsx";
import { RoomEditor } from "./components/RoomEditor.tsx";
import { cutListToCsv, downloadText, projectFromJson, projectToJson } from "./exports.ts";
import { usePlannerState } from "./state/usePlannerState.ts";

function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {title ? <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2> : null}
      {children}
    </section>
  );
}

export function App() {
  const {
    inputs,
    setInputs,
    resetInputs,
    loadProject,
    result,
    view,
    setView,
    activePlan,
    activeOptionIndex,
  } = usePlannerState();
  const fileRef = useRef<HTMLInputElement>(null);

  const displayPieces = useMemo(() => {
    if (!activePlan) return [];
    const rows = activePlan.layoutOptions[activeOptionIndex]?.rows ?? activePlan.rows;
    // Polygon plans carry no rows — their clipped pieces are authoritative.
    if (!rows.length) return activePlan.pieces;
    return piecesForOption(activePlan.geometry, rows, inputs.board.length);
  }, [activePlan, activeOptionIndex, inputs.board.length]);

  const allDiagnostics = [...result.diagnostics, ...(activePlan?.diagnostics ?? [])];

  const gapWarn = result.diagnostics.some(
    (d) => d.code === "gap.tooSmall" || d.code === "gap.negative",
  );

  const onLoadFile = async (file: File) => {
    try {
      const text = await file.text();
      loadProject(projectFromJson(text));
    } catch (e) {
      alert(`Could not load project: ${(e as Error).message}`);
    }
  };

  return (
    <div className="min-h-full bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white px-4 py-3 print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-slate-800">
              Laminate Floor Layout Planner
            </h1>
            <p className="text-[11px] text-slate-500">
              Row balancing · staggered cut pattern · offcut reuse · material estimate
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-100"
            >
              Print
            </button>
            <button
              type="button"
              disabled={!activePlan}
              onClick={() =>
                activePlan && downloadText("cut-list.csv", cutListToCsv(activePlan), "text/csv")
              }
              className="rounded border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() =>
                downloadText("floor-plan.json", projectToJson(inputs), "application/json")
              }
              className="rounded border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-100"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded border border-slate-300 px-2.5 py-1.5 text-slate-600 hover:bg-slate-100"
            >
              Load
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onLoadFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[360px_1fr]">
        <aside className="flex flex-col gap-4 print:hidden lg:sticky lg:top-4 lg:self-start">
          <Card>
            <BoardDiagram inputs={inputs} setInputs={setInputs} />
          </Card>
          <Card>
            <InputsPanel
              inputs={inputs}
              setInputs={setInputs}
              onReset={resetInputs}
              activePlan={activePlan}
            />
          </Card>
        </aside>

        <div className="flex flex-col gap-4">
          {allDiagnostics.length ? <DiagnosticsBanner diagnostics={allDiagnostics} /> : null}

          <Card title="Room shape">
            <RoomEditor inputs={inputs} setInputs={setInputs} />
          </Card>

          {activePlan ? (
            <>
              <Card title="Floor plan">
                <div className="flex flex-col gap-3">
                  <PlanCanvas
                    inputs={inputs}
                    setInputs={setInputs}
                    plan={activePlan}
                    pieces={displayPieces}
                    gapWarn={gapWarn}
                  />
                  <PlanLegend />
                </div>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card title="Orientation & borders" className="print:hidden">
                  <OrientationCompare
                    result={result}
                    view={view}
                    setView={setView}
                    activePlan={activePlan}
                    activeOptionIndex={activeOptionIndex}
                    room={inputs.room}
                  />
                </Card>
                <Card title="Material estimate">
                  <MaterialSummary plan={activePlan} />
                </Card>
              </div>

              <Card title="Cut list & offcut reuse">
                <CutListTable plan={activePlan} />
              </Card>
            </>
          ) : (
            <Card title="No valid layout">
              <p className="text-sm text-slate-600">
                The current inputs can&rsquo;t produce a valid floor layout. Fix the errors above
                and the plan will update automatically.
              </p>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
