import { useEffect, useRef } from "react";
import { type SimState } from "@/lib/simulation";

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
};

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
    const hist: typeof histAll = [];
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
    ctx.fillText(`${t0.toFixed(1)} s`, pad.l - 2, height - 6);
    ctx.fillText(`${tHi.toFixed(1)} s`, pad.l + w - 36, height - 6);

    const xOf = (t: number) => pad.l + ((t - t0) / tSpan) * w;
    const yOf = (Tc: number) => pad.t + h * (1 - (Tc - yMinC) / (yMaxC - yMinC));

    // horizontal markers
    drawMarker(ctx, pad.l, pad.l + w, yOf(maillardC), COL.maillard, `Maillard ${maillardC}°`);
    drawMarker(ctx, pad.l, pad.l + w, yOf(searingC), COL.searing, `Sear ${searingC}°`);

    if (hist.length < 2) return;

    // Draw order matters: T_edge can coincide with T_center when the heater
    // is a ring (until heat reaches both extremes). Paint T_edge last so its
    // line stays visible in that case.
    drawSeries(ctx, hist, xOf, yOf, (s) => s.Tmax - 273.15, COL.max);
    drawSeries(ctx, hist, xOf, yOf, (s) => s.Tcenter - 273.15, COL.center);
    drawSeries(ctx, hist, xOf, yOf, (s) => s.Tedge - 273.15, COL.min);
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

  return <canvas ref={ref} />;
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

function drawSeries(
  ctx: CanvasRenderingContext2D,
  hist: { t: number; Tcenter: number; Tmax: number; Tedge: number }[],
  xOf: (t: number) => number,
  yOf: (Tc: number) => number,
  pick: (s: { t: number; Tcenter: number; Tmax: number; Tedge: number }) => number,
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
