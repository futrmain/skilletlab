import { useEffect, useRef } from "react";
import { ChartHoverOverlay } from "./ChartHoverOverlay";

export interface ProfileExtra {
  T: Float64Array;
  color: string;
  label: string;
}

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
  // Cooking-edge radius (m). When supplied and < rOuter, draws a dashed
  // vertical line marking the start of the rim flange.
  rCooking?: number;
  // Per-tick signal (e.g. state.time) so the canvas redraws even when the
  // T/r typed-array references stay stable (their contents mutate in place).
  tick?: number;
  // Optional milestone snapshots to draw underneath the live (current) curve.
  // All extras share the same `r` mesh as the live profile.
  extras?: ProfileExtra[];
}

const PRIMARY_COLOR = "oklch(0.78 0.18 75)";

interface HoverData {
  T: Float64Array;
  r: Float64Array;
  rMax: number;
  tMin: number;
  tMax: number;
  plotArea: { x0: number; x1: number; y0: number; y1: number };
  extras: ProfileExtra[];
}

export function ProfileChart({
  T,
  r,
  tMin,
  tMax,
  width = 380,
  height = 180,
  rOuter,
  rCooking,
  tick,
  extras,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<HoverData | null>(null);
  // Stable reference for the resolver — extras may change every render but
  // the typed-array data is owned by the SimState so structural identity is
  // safe enough for the binary-search lookup.
  const safeExtras = extras ?? [];
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

    // Rim marker — dashed vertical line at the cooking-edge radius.
    if (rCooking && rCooking > 0 && rCooking < rMax) {
      const xRim = pad.l + (rCooking / rMax) * w;
      ctx.strokeStyle = "rgba(220, 220, 220, 0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xRim, pad.t);
      ctx.lineTo(xRim, pad.t + h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(220, 220, 220, 0.65)";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText("rim", xRim + 3, pad.t + 9);
    }

    // Milestone snapshots — drawn before the live curve so the live one sits
    // on top. Slightly thinner, no transparency tricks; their colors are
    // already chosen to be distinguishable from the primary amber.
    const drawCurve = (data: Float64Array, color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = pad.l + (r[i] / rMax) * w;
        const norm = (data[i] - tMin) / Math.max(1e-6, tMax - tMin);
        const y = pad.t + h * (1 - norm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    for (const e of safeExtras) {
      if (e.T.length === r.length) drawCurve(e.T, e.color, 1.75);
    }

    hoverRef.current = {
      T,
      r,
      rMax,
      tMin,
      tMax,
      plotArea: { x0: pad.l, x1: pad.l + w, y0: pad.t, y1: pad.t + h },
      extras: safeExtras,
    };
  }, [T, r, tMin, tMax, width, height, rOuter, rCooking, tick, safeExtras]);

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
          // Map cursor x to physical radius then to nearest cell index in
          // the shared mesh.
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
          const xPx = x0 + (rcell / d.rMax) * (x1 - x0);
          const validExtras = d.extras.filter((e) => e.T.length === d.r.length);
          // Anchor the dot to the topmost (= first) milestone curve at this
          // radius; if no milestones have latched yet, just show the hairline.
          let dotY: number | undefined;
          if (validExtras.length > 0) {
            const Tk = validExtras[0].T[idx];
            const norm = (Tk - d.tMin) / Math.max(1e-6, d.tMax - d.tMin);
            dotY = y0 + (y1 - y0) * (1 - norm);
          }
          return {
            x: xPx,
            y: dotY,
            content: (
              <div className="space-y-0.5">
                <div className="text-muted-foreground">r = {(rcell * 100).toFixed(2)} cm</div>
                {validExtras.map((e, i) => (
                  <div key={i} style={{ color: e.color }}>
                    {e.label} = {(e.T[idx] - 273.15).toFixed(1)}°C
                  </div>
                ))}
              </div>
            ),
          };
        }}
      />
    </div>
  );
}
