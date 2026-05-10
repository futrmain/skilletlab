import { useEffect, useRef } from "react";
import { ChartHoverOverlay } from "./ChartHoverOverlay";

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

interface HoverData {
  T: Float64Array;
  r: Float64Array;
  rMax: number;
  tMin: number;
  tMax: number;
  plotArea: { x0: number; x1: number; y0: number; y1: number };
}

export function ProfileChart({ T, r, tMin, tMax, width = 380, height = 180, rOuter, tick }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<HoverData | null>(null);
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

    hoverRef.current = {
      T,
      r,
      rMax,
      tMin,
      tMax,
      plotArea: { x0: pad.l, x1: pad.l + w, y0: pad.t, y1: pad.t + h },
    };
  }, [T, r, tMin, tMax, width, height, rOuter, tick]);

  return (
    <div className="relative inline-block" style={{ width, height }}>
      <canvas ref={ref} width={width} height={height} style={{ width, height }} />
      <ChartHoverOverlay
        width={width}
        height={height}
        resolve={(px, py) => {
          const d = hoverRef.current;
          if (!d || d.T.length === 0) return null;
          const { x0, x1, y0, y1 } = d.plotArea;
          if (px < x0 || px > x1 || py < y0 || py > y1) return null;
          // Map cursor x to physical radius then to nearest cell index.
          const rTarget = ((px - x0) / (x1 - x0)) * d.rMax;
          let lo = 0;
          let hi = d.r.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (d.r[mid] < rTarget) lo = mid + 1;
            else hi = mid;
          }
          let idx = lo;
          if (lo > 0 && Math.abs(d.r[lo - 1] - rTarget) < Math.abs(d.r[lo] - rTarget)) idx = lo - 1;
          const rcell = d.r[idx];
          const Tk = d.T[idx];
          const xPx = x0 + (rcell / d.rMax) * (x1 - x0);
          const norm = (Tk - d.tMin) / Math.max(1e-6, d.tMax - d.tMin);
          const yPx = y0 + (y1 - y0) * (1 - norm);
          return {
            x: xPx,
            y: yPx,
            content: (
              <div className="space-y-0.5">
                <div className="text-muted-foreground">r = {(rcell * 100).toFixed(2)} cm</div>
                <div style={{ color: "oklch(0.78 0.18 75)" }}>T = {(Tk - 273.15).toFixed(1)}°C</div>
              </div>
            ),
          };
        }}
      />
    </div>
  );
}
