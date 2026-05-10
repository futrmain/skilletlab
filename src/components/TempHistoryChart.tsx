import { useEffect, useRef } from "react";
import { type SimState, type HistorySample } from "@/lib/simulation";
import { formatSimTime } from "@/lib/format";
import { ChartHoverOverlay } from "./ChartHoverOverlay";

interface Props {
  state: SimState | null;
  initialTempK: number;
  width?: number;
  height?: number;
  maillardC?: number;
  searingC?: number;
  // Force a shared y range across cards (in °C). Markers are still kept inside.
  yRangeCOverride?: { min: number; max: number };
  // Optional time-window filter — only samples with t in [tStart, tEnd] are
  // drawn, and the x-axis is clamped to this window. tStart defaults to 0;
  // tEnd defaults to "the latest sample time within the window".
  tStart?: number;
  tEnd?: number;
}

const COL = {
  center: "oklch(0.78 0.18 75)", // amber — matches ProfileChart
  max: "oklch(0.7 0.2 25)", // red
  min: "oklch(0.78 0.18 220)", // blue
  maillard: "rgba(255, 200, 90, 0.7)",
  searing: "rgba(255, 110, 90, 0.8)",
  // Vertical milestone markers (sim-event timestamps).
  ready: "rgba(110, 220, 180, 0.7)", // teal — pan ready to cook
  steady: "rgba(160, 220, 110, 0.7)", // lime — steady state
  flipped: "rgba(190, 150, 230, 0.75)", // purple — steak flipped
};

interface HoverData {
  hist: HistorySample[];
  xOf: (t: number) => number;
  yOf: (Tc: number) => number;
  plotArea: { x0: number; x1: number; y0: number; y1: number };
  t0: number;
  tHi: number;
}

export function TempHistoryChart({
  state,
  initialTempK,
  width = 320,
  height = 140,
  maillardC = 150,
  searingC = 200,
  yRangeCOverride,
  tStart,
  tEnd,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<HoverData | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const pad = { l: 36, r: 8, t: 12, b: 24 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    const histAll = state?.history ?? [];
    const t0 = tStart ?? 0;
    // Pick the samples that fall inside the window. Allow a tiny epsilon at
    // the boundaries so a sample landing exactly on tStart/tEnd is kept.
    const hist: HistorySample[] = [];
    for (const s of histAll) {
      if (s.t < t0 - 1e-9) continue;
      if (tEnd !== undefined && s.t > tEnd + 1e-9) continue;
      hist.push(s);
    }
    const latest = hist.length > 0 ? hist[hist.length - 1].t : t0;
    const tHi = tEnd !== undefined ? tEnd : Math.max(latest, t0 + 1e-3);
    const tSpan = Math.max(1e-9, tHi - t0);

    // y range — must cover data + both markers, with a touch of headroom.
    // When an override is supplied (sync-scales mode), seed with the override
    // and still extend to keep the markers visible.
    const initialC = initialTempK - 273.15;
    let yMinC: number;
    let yMaxC: number;
    if (yRangeCOverride) {
      yMinC = Math.min(yRangeCOverride.min, maillardC, searingC);
      yMaxC = Math.max(yRangeCOverride.max, maillardC, searingC);
    } else {
      yMinC = Math.min(initialC, maillardC, searingC);
      yMaxC = Math.max(initialC + 50, maillardC, searingC);
      for (const s of hist) {
        const edgeC = s.Tedge - 273.15;
        const maxC = s.Tmax - 273.15;
        if (edgeC < yMinC) yMinC = edgeC;
        if (maxC > yMaxC) yMaxC = maxC;
      }
    }
    yMinC = Math.floor(yMinC / 10) * 10 - 10;
    yMaxC = Math.ceil(yMaxC / 10) * 10 + 10;

    // grid + y axis labels
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const v = yMaxC - ((yMaxC - yMinC) * i) / 4;
      ctx.fillText(`${v.toFixed(0)}°`, 4, y + 3);
    }

    // x axis labels — show the actual window endpoints.
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.fillText(formatSimTime(t0), pad.l - 2, height - 6);
    ctx.fillText(formatSimTime(tHi), pad.l + w - 36, height - 6);

    const xOf = (t: number) => pad.l + ((t - t0) / tSpan) * w;
    const yOf = (Tc: number) => pad.t + h * (1 - (Tc - yMinC) / (yMaxC - yMinC));

    // horizontal markers
    drawMarker(ctx, pad.l, pad.l + w, yOf(maillardC), COL.maillard, `Maillard ${maillardC}°`);
    drawMarker(ctx, pad.l, pad.l + w, yOf(searingC), COL.searing, `Sear ${searingC}°`);

    // vertical milestone markers — only drawn when the milestone has latched
    // and falls inside the visible window. Labels are rendered vertically,
    // anchored at the bottom of the plot area, on the left side of the line.
    const yPlotTop = pad.t;
    const yPlotBot = pad.t + h;
    const inWindow = (t: number) => t >= t0 - 1e-9 && t <= tHi + 1e-9;
    const tReady = state?.cookingReadyAtTime ?? null;
    // "Steady" here means the FIRST steady state — the moment the pan
    // reaches its limit cycle and the steak gets dropped (when steak is
    // enabled), or the limit-cycle convergence (when no steak).
    const tSteady = state?.steakDroppedAt ?? state?.steadyAtTime ?? null;
    const tFlipped = state?.steakFlippedAt ?? null;
    if (tReady != null && inWindow(tReady)) {
      drawVMarker(ctx, xOf(tReady), yPlotTop, yPlotBot, COL.ready, `Ready ${formatSimTime(tReady)}`);
    }
    if (tFlipped != null && inWindow(tFlipped)) {
      drawVMarker(ctx, xOf(tFlipped), yPlotTop, yPlotBot, COL.flipped, `Flip ${formatSimTime(tFlipped)}`);
    }
    if (tSteady != null && inWindow(tSteady)) {
      drawVMarker(ctx, xOf(tSteady), yPlotTop, yPlotBot, COL.steady, `Steady ${formatSimTime(tSteady)}`);
    }

    if (hist.length >= 2) {
      // Draw order matters: T_edge can coincide with T_center when the heater
      // is a ring (until heat reaches both extremes). Paint T_edge last so its
      // line stays visible in that case.
      drawSeries(ctx, hist, xOf, yOf, (s) => s.Tmax - 273.15, COL.max);
      drawSeries(ctx, hist, xOf, yOf, (s) => s.Tcenter - 273.15, COL.center);
      drawSeries(ctx, hist, xOf, yOf, (s) => s.Tedge - 273.15, COL.min);
    }

    hoverRef.current = {
      hist,
      xOf,
      yOf,
      plotArea: { x0: pad.l, x1: pad.l + w, y0: pad.t, y1: pad.t + h },
      t0,
      tHi,
    };
    // history.length is the per-tick signal that retriggers this effect; the
    // SimState reference itself is stable across renders so we can't depend on
    // it directly.
  }, [
    state,
    state?.history.length,
    width,
    height,
    maillardC,
    searingC,
    initialTempK,
    yRangeCOverride?.min,
    yRangeCOverride?.max,
    tStart,
    tEnd,
  ]);

  return (
    <div className="relative inline-block" style={{ width, height }}>
      <canvas ref={ref} />
      <ChartHoverOverlay
        width={width}
        height={height}
        resolve={(px, py) => {
          const d = hoverRef.current;
          if (!d || d.hist.length < 2) return null;
          const { x0, x1, y0, y1 } = d.plotArea;
          if (px < x0 || px > x1 || py < y0 || py > y1) return null;
          const t = d.t0 + ((px - x0) / (x1 - x0)) * (d.tHi - d.t0);
          let lo = 0;
          let hi = d.hist.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (d.hist[mid].t < t) lo = mid + 1;
            else hi = mid;
          }
          let idx = lo;
          if (lo > 0 && Math.abs(d.hist[lo - 1].t - t) < Math.abs(d.hist[lo].t - t)) idx = lo - 1;
          const s = d.hist[idx];
          return {
            x: d.xOf(s.t),
            y: d.yOf(s.Tcenter - 273.15),
            content: (
              <div className="space-y-0.5">
                <div className="text-muted-foreground">t = {formatSimTime(s.t)}</div>
                <div style={{ color: COL.center }}>
                  center = {(s.Tcenter - 273.15).toFixed(1)}°C
                </div>
                <div style={{ color: COL.max }}>max = {(s.Tmax - 273.15).toFixed(1)}°C</div>
                <div style={{ color: COL.min }}>edge = {(s.Tedge - 273.15).toFixed(1)}°C</div>
              </div>
            ),
          };
        }}
      />
    </div>
  );
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  color: string,
  label: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.font = "9px ui-monospace, monospace";
  ctx.fillText(label, x0 + 4, y - 2);
}

function drawVMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y0: number,
  y1: number,
  color: string,
  label: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  // Vertical label, anchored at the bottom of the line, sitting on the LEFT
  // side of the line. Text reads from bottom to top.
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = "9px ui-monospace, monospace";
  ctx.translate(x - 2, y1 - 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawSeries(
  ctx: CanvasRenderingContext2D,
  hist: HistorySample[],
  xOf: (t: number) => number,
  yOf: (Tc: number) => number,
  pick: (s: HistorySample) => number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  for (let i = 0; i < hist.length; i++) {
    const x = xOf(hist[i].t);
    const y = yOf(pick(hist[i]));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
