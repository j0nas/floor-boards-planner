import { type CSSProperties, useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  onChange: (n: number) => void;
  label?: string;
  suffix?: string;
  title?: string;
  min?: number;
  step?: number;
  /** Max decimal places kept; trailing zeros are stripped (e.g. 9.50 → "9.5"). */
  decimals?: number;
  tone?: "default" | "red" | "violet";
  style?: CSSProperties;
  widthCh?: number;
}

const roundTo = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};

const TONE: Record<NonNullable<Props["tone"]>, string> = {
  default: "border-slate-300",
  red: "border-red-400 ring-1 ring-red-200",
  violet: "border-violet-300",
};

/**
 * A small inline numeric input rendered as a chip — meant to sit directly on
 * the drawing (room edge, board face) so the dimension is edited in place.
 * Keeps a local string while focused so the plan never vanishes mid-edit.
 */
export function EditableDim({
  value,
  onChange,
  label,
  suffix = "mm",
  title,
  min = 1,
  step = 10,
  decimals = 2,
  tone = "default",
  style,
  widthCh = 4,
}: Props) {
  const fmt = (v: number) => String(roundTo(v, decimals));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);

  // Up/Down nudge the value by `step` (×10 with Shift), like a number spinner.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const parsed = Number.parseFloat(text);
    const current = Number.isFinite(parsed) ? parsed : value;
    const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
    const next = Math.max(min, roundTo(current + delta, decimals));
    setText(fmt(next));
    onChange(next);
  };

  return (
    <span
      className={`pointer-events-auto inline-flex items-center gap-1 rounded-md border bg-white/95 px-1.5 py-0.5 text-xs shadow-sm backdrop-blur-sm ${TONE[tone]}`}
      style={style}
      title={title}
    >
      {label ? <span className="text-[10px] font-medium text-slate-400">{label}</span> : null}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={title ?? label}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          const n = Number.parseFloat(text);
          setText(Number.isFinite(n) && n >= min ? fmt(n) : fmt(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number.parseFloat(e.target.value);
          if (Number.isFinite(n) && n >= min) onChange(roundTo(n, decimals));
        }}
        onKeyDown={onKeyDown}
        className="bg-transparent text-right tabular-nums text-slate-800 outline-none"
        style={{ width: `${Math.max(widthCh, text.length) + 0.5}ch` }}
      />
      {suffix ? <span className="text-[10px] text-slate-400">{suffix}</span> : null}
    </span>
  );
}
