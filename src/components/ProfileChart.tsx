import { useEffect, useRef } from "react";

interface Props {
  T: Float64Array;
  r: Float64Array;
  tMin: number;
  tMax: number;
  width?: number;
  height?: number;
  // Total physical radius (m). Used as the x-axis upper bound. Without this
  // the chart falls back to r[N-1] which is the last cell-center, leaving a
  // half-cell gap to the actual outer edge of the pan.
  rOuter?: number;
  // Per-tick signal (e.g. state.time) so the canvas redraws even when the
  // T/r typed-array references stay stable (their contents mutate in place).
  tick?: number;
}

export function ProfileChart({
  T,
  r,
  tMin,
  tMax,
  width = 380,
  height = 180,
  rOuter,
  tick,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const pad = { l: 36, r: 8, t: 12, b: 24 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
    }

    // axes labels
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 4; i++) {
      const v = tMax - ((tMax - tMin) * i) / 4;
      const y = pad.t + (h * i) / 4;
      ctx.fillText(`${(v - 273.15).toFixed(0)}°`, 4, y + 3);
    }
    const rMax = rOuter && rOuter > 0 ? rOuter : r[r.length - 1];
    ctx.fillText("0", pad.l - 2, height - 6);
    ctx.fillText(`${(rMax * 100).toFixed(1)} cm`, pad.l + w - 36, height - 6);

    // line
    ctx.strokeStyle = "oklch(0.78 0.18 75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < T.length; i++) {
      const x = pad.l + (r[i] / rMax) * w;
      const norm = (T[i] - tMin) / Math.max(1e-6, tMax - tMin);
      const y = pad.t + h * (1 - norm);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [T, r, tMin, tMax, width, height, rOuter, tick]);

  return <canvas ref={ref} width={width} height={height} style={{ width, height }} />;
}
