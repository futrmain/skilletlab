import { useEffect, useRef } from "react";
import { type SimState } from "@/lib/simulation";

export interface CompareEntry {
  key: string;
  label: string;
  state: SimState | null;
  initialTempK: number;
  color: string;
}

const PALETTE = [
  "oklch(0.78 0.18 75)",
  "oklch(0.7 0.2 25)",
  "oklch(0.7 0.18 150)",
  "oklch(0.7 0.2 280)",
  "oklch(0.78 0.18 200)",
  "oklch(0.75 0.2 320)",
  "oklch(0.8 0.18 100)",
  "oklch(0.7 0.2 50)",
];
export const colorForIndex = (i: number) => PALETTE[i % PALETTE.length];

interface PProps {
  entries: CompareEntry[];
  width?: number;
  height?: number;
}

export function CompareProfileChart({ entries, width = 720, height = 320 }: PProps) {
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

    const pad = { l: 48, r: 12, t: 16, b: 28 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    // domain — use the actual physical extent (panRadius + rimHeight) rather
    // than the last cell-center, so the axis matches the pan dimensions.
    let rMax = 0.001;
    let tMin = Infinity,
      tMax = -Infinity;
    for (const e of entries) {
      const T = e.state?.T;
      const R = e.state?.r;
      const params = e.state?.params;
      if (!T || !R) {
        tMin = Math.min(tMin, e.initialTempK);
        tMax = Math.max(tMax, e.initialTempK + 50);
        continue;
      }
      const physOuter = params ? params.panRadius + params.rimHeight : R[R.length - 1];
      rMax = Math.max(rMax, physOuter);
      for (let i = 0; i < T.length; i++) {
        if (T[i] < tMin) tMin = T[i];
        if (T[i] > tMax) tMax = T[i];
      }
    }
    if (!Number.isFinite(tMin)) tMin = 293.15;
    if (!Number.isFinite(tMax)) tMax = 343.15;
    if (tMax - tMin < 50) tMax = tMin + 50;

    // grid + y labels
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const v = tMax - ((tMax - tMin) * i) / 5;
      ctx.fillText(`${(v - 273.15).toFixed(0)}°C`, 4, y + 3);
    }
    // x labels
    for (let i = 0; i <= 4; i++) {
      const x = pad.l + (w * i) / 4;
      const r = (rMax * i) / 4;
      ctx.fillText(`${(r * 100).toFixed(1)}cm`, x - 12, height - 8);
    }

    // axis title
    ctx.fillStyle = "rgba(180,180,180,0.7)";
    ctx.fillText("radius →", pad.l + w - 60, pad.t - 4);

    for (const e of entries) {
      const T = e.state?.T;
      const R = e.state?.r;
      if (!T || !R) continue;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < T.length; i++) {
        const x = pad.l + (R[i] / rMax) * w;
        const norm = (T[i] - tMin) / (tMax - tMin);
        const y = pad.t + h * (1 - norm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [entries, width, height]);

  return <canvas ref={ref} />;
}

interface BProps {
  entries: CompareEntry[];
  width?: number;
  height?: number;
}

export function CompareDeltaBars({ entries, width = 720, height = 280 }: BProps) {
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

    const pad = { l: 48, r: 16, t: 16, b: 64 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    const data = entries.map((e) => {
      const st = e.state;
      const T = st?.T;
      let edge = e.initialTempK;
      let hi = e.initialTempK;
      if (T && st) {
        const nIn = st.nInner;
        // Max over cooking zone only (rim is cold by design and would dominate).
        hi = -Infinity;
        for (let i = 0; i < nIn; i++) if (T[i] > hi) hi = T[i];
        // T_edge: the cell at the cooking-zone outer edge.
        edge = T[nIn - 1];
      }
      return { e, delta: Math.max(0, hi - edge) };
    });

    const maxDelta = Math.max(10, ...data.map((d) => d.delta));

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const v = maxDelta - (maxDelta * i) / 5;
      ctx.fillText(`${v.toFixed(0)}°`, 4, y + 3);
    }

    if (data.length === 0) return;
    const slot = w / data.length;
    const barW = Math.min(60, slot * 0.6);

    data.forEach((d, i) => {
      const x = pad.l + slot * i + (slot - barW) / 2;
      const bh = (d.delta / maxDelta) * h;
      const y = pad.t + (h - bh);
      ctx.fillStyle = d.e.color;
      ctx.fillRect(x, y, barW, bh);
      // value
      ctx.fillStyle = "rgba(240,240,240,0.95)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${d.delta.toFixed(1)}°`, x + barW / 2, y - 4);
      // label (truncate)
      ctx.fillStyle = "rgba(200,200,200,0.8)";
      ctx.font = "10px ui-monospace, monospace";
      const label = d.e.label.length > 18 ? d.e.label.slice(0, 17) + "…" : d.e.label;
      ctx.save();
      ctx.translate(x + barW / 2, pad.t + h + 8);
      ctx.rotate(-Math.PI / 6);
      ctx.textAlign = "right";
      ctx.fillText(label, 0, 8);
      ctx.restore();
    });
    ctx.textAlign = "left";

    // title
    ctx.fillStyle = "rgba(180,180,180,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("T_max − T_edge (°C)", pad.l, pad.t - 4);
  }, [entries, width, height]);

  return <canvas ref={ref} />;
}

export function CompareCookingReadyBars({ entries, width = 720, height = 280 }: BProps) {
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

    const pad = { l: 48, r: 16, t: 16, b: 64 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    const data = entries.map((e) => ({
      e,
      time: e.state?.cookingReadyAtTime ?? null,
    }));

    const maxTime = Math.max(10, ...data.map((d) => d.time ?? 0));

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const v = maxTime - (maxTime * i) / 5;
      ctx.fillText(`${v.toFixed(0)} s`, 4, y + 3);
    }

    if (data.length === 0) return;
    const slot = w / data.length;
    const barW = Math.min(60, slot * 0.6);

    data.forEach((d, i) => {
      const x = pad.l + slot * i + (slot - barW) / 2;
      if (d.time != null) {
        const bh = (d.time / maxTime) * h;
        const y = pad.t + (h - bh);
        ctx.fillStyle = d.e.color;
        ctx.fillRect(x, y, barW, bh);
        ctx.fillStyle = "rgba(240,240,240,0.95)";
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${d.time.toFixed(1)} s`, x + barW / 2, y - 4);
      } else {
        // Placeholder: faint outlined slot + "—" so the user sees the entry exists.
        ctx.strokeStyle = d.e.color;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x, pad.t + h - 6, barW, 6);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(200,200,200,0.55)";
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText("—", x + barW / 2, pad.t + h - 10);
      }
      // label (truncate, rotated)
      ctx.fillStyle = "rgba(200,200,200,0.8)";
      ctx.font = "10px ui-monospace, monospace";
      const label = d.e.label.length > 18 ? d.e.label.slice(0, 17) + "…" : d.e.label;
      ctx.save();
      ctx.translate(x + barW / 2, pad.t + h + 8);
      ctx.rotate(-Math.PI / 6);
      ctx.textAlign = "right";
      ctx.fillText(label, 0, 8);
      ctx.restore();
    });
    ctx.textAlign = "left";

    // title
    ctx.fillStyle = "rgba(180,180,180,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("Cooking ready time (s) — lower is faster", pad.l, pad.t - 4);
  }, [entries, width, height]);

  return <canvas ref={ref} />;
}

interface SProps {
  entries: CompareEntry[];
  width?: number;
  height?: number;
}

export function CompareSpreadVsReadyScatter({ entries, width = 520, height = 360 }: SProps) {
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

    const pad = { l: 64, r: 16, t: 16, b: 44 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    const points = entries.flatMap((e) => {
      const st = e.state;
      const tc = st?.cookingReadyAtTime;
      const T = st?.T;
      if (tc == null || !T || !st || T.length === 0) return [];
      const nIn = st.nInner;
      let hi = -Infinity;
      for (let i = 0; i < nIn; i++) if (T[i] > hi) hi = T[i];
      const edge = T[nIn - 1];
      return [{ entry: e, tc, delta: Math.max(0, hi - edge) }];
    });

    let xDataMin = Infinity;
    let xDataMax = 10;
    let yDataMin = Infinity;
    let yDataMax = 10;
    for (const p of points) {
      if (p.tc < xDataMin) xDataMin = p.tc;
      if (p.tc > xDataMax) xDataMax = p.tc;
      if (p.delta < yDataMin) yDataMin = p.delta;
      if (p.delta > yDataMax) yDataMax = p.delta;
    }
    if (!Number.isFinite(xDataMin)) xDataMin = 0;
    if (!Number.isFinite(yDataMin)) yDataMin = 0;
    // 20% headroom above the max; symmetric padding below clamped to 0.
    const xMax = xDataMax * 1.2;
    const xMin = Math.max(0, xDataMin - 0.2 * xDataMax);
    const yMax = yDataMax * 1.2;
    const yMin = Math.max(0, yDataMin - 0.2 * yDataMax);
    const xRange = Math.max(xMax - xMin, 1);
    const yRange = Math.max(yMax - yMin, 1);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const v = yMax - yRange * (i / 5);
      ctx.fillText(`${v.toFixed(0)}°`, 4, y + 3);
    }
    for (let i = 0; i <= 5; i++) {
      const x = pad.l + (w * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + h);
      ctx.stroke();
      const v = xMin + xRange * (i / 5);
      ctx.fillText(`${v.toFixed(0)}`, x - 8, height - 26);
    }

    ctx.fillStyle = "rgba(180,180,180,0.75)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("Cooking ready (s)", pad.l + w / 2, height - 8);
    ctx.save();
    ctx.translate(14, pad.t + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("T_max − T_edge (°C)", 0, 0);
    ctx.restore();
    ctx.textAlign = "left";

    const xOf = (t: number) => pad.l + ((t - xMin) / xRange) * w;
    const yOf = (d: number) => pad.t + h * (1 - (d - yMin) / yRange);

    if (points.length === 0) {
      ctx.fillStyle = "rgba(180,180,180,0.6)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for simulations to reach cooking-ready…", pad.l + w / 2, pad.t + h / 2);
      ctx.textAlign = "left";
      return;
    }

    for (const p of points) {
      const x = xOf(p.tc);
      const y = yOf(p.delta);
      ctx.fillStyle = p.entry.color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }, [entries, width, height]);

  return <canvas ref={ref} />;
}

export function CompareReadyVsSteadyScatter({ entries, width = 520, height = 360 }: SProps) {
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

    const pad = { l: 64, r: 16, t: 16, b: 44 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    // Only plot entries that have both milestones latched.
    const points = entries.flatMap((e) => {
      const tc = e.state?.cookingReadyAtTime;
      const ts = e.state?.steadyAtTime;
      if (tc == null || ts == null) return [];
      return [{ entry: e, tc, ts }];
    });

    // Equal range on both axes so the y=x diagonal stays meaningful.
    let aDataMin = Infinity;
    let aDataMax = 10;
    for (const p of points) {
      if (p.tc < aDataMin) aDataMin = p.tc;
      if (p.ts < aDataMin) aDataMin = p.ts;
      if (p.tc > aDataMax) aDataMax = p.tc;
      if (p.ts > aDataMax) aDataMax = p.ts;
    }
    if (!Number.isFinite(aDataMin)) aDataMin = 0;
    const aMax = aDataMax * 1.2;
    const aMin = Math.max(0, aDataMin - 0.2 * aDataMax);
    const aRange = Math.max(aMax - aMin, 1);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const v = aMax - aRange * (i / 5);
      ctx.fillText(`${v.toFixed(0)} s`, 4, y + 3);
    }
    for (let i = 0; i <= 5; i++) {
      const x = pad.l + (w * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + h);
      ctx.stroke();
      const v = aMin + aRange * (i / 5);
      ctx.fillText(`${v.toFixed(0)}`, x - 8, height - 26);
    }

    ctx.fillStyle = "rgba(180,180,180,0.75)";
    ctx.font = "11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("Cooking ready (s)", pad.l + w / 2, height - 8);
    ctx.save();
    ctx.translate(14, pad.t + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Steady state (s)", 0, 0);
    ctx.restore();
    ctx.textAlign = "left";

    const xOf = (t: number) => pad.l + ((t - aMin) / aRange) * w;
    const yOf = (t: number) => pad.t + h * (1 - (t - aMin) / aRange);

    // y = x reference — steady-state can never come before cooking-ready, so
    // points should always land on or above the diagonal.
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xOf(aMin), yOf(aMin));
    ctx.lineTo(xOf(aMax), yOf(aMax));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(180,180,180,0.5)";
    ctx.font = "9px ui-monospace, monospace";
    const labelAt = aMin + aRange * 0.92;
    ctx.fillText("y = x", xOf(labelAt) - 24, yOf(labelAt) - 4);

    if (points.length === 0) {
      ctx.fillStyle = "rgba(180,180,180,0.6)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        "Waiting for simulations to reach both milestones…",
        pad.l + w / 2,
        pad.t + h / 2,
      );
      ctx.textAlign = "left";
      return;
    }

    for (const p of points) {
      const x = xOf(p.tc);
      const y = yOf(p.ts);
      ctx.fillStyle = p.entry.color;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }, [entries, width, height]);

  return <canvas ref={ref} />;
}

export function CompareLegend({ entries }: { entries: CompareEntry[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {entries.map((e) => (
        <div key={e.key} className="flex items-center gap-2 text-xs">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: e.color }} />
          <span className="text-foreground">{e.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Milestone-based comparison helpers — every chart below reads a SNAPSHOT
// captured in the solver at one of three milestones (ready, steady, local
// min after steak drop), via `picker(state)`.
// ---------------------------------------------------------------------------

export type SnapshotPicker = (state: SimState) => Float64Array | null;
export type TimePicker = (state: SimState) => number | null;

interface MProfileProps {
  entries: CompareEntry[];
  picker: SnapshotPicker;
  width?: number;
  height?: number;
}

// Overlaid radial profile for a single milestone — one line per pan, drawn
// only for pans whose snapshot exists. Identical look to CompareProfileChart.
export function CompareMilestoneProfileChart({
  entries,
  picker,
  width = 520,
  height = 280,
}: MProfileProps) {
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
    const pad = { l: 48, r: 12, t: 16, b: 28 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    let rMax = 0.001;
    let tMin = Infinity;
    let tMax = -Infinity;
    let any = false;
    for (const e of entries) {
      const st = e.state;
      const T = st ? picker(st) : null;
      if (!st || !T || T.length === 0) continue;
      any = true;
      const physOuter = st.params.panRadius + st.params.rimHeight;
      rMax = Math.max(rMax, physOuter);
      for (let i = 0; i < T.length; i++) {
        if (T[i] < tMin) tMin = T[i];
        if (T[i] > tMax) tMax = T[i];
      }
    }
    if (!any) {
      ctx.fillStyle = "rgba(180,180,180,0.5)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Not yet captured", pad.l + w / 2, pad.t + h / 2);
      ctx.textAlign = "left";
      return;
    }
    if (!Number.isFinite(tMin)) tMin = 293.15;
    if (!Number.isFinite(tMax)) tMax = 343.15;
    if (tMax - tMin < 50) tMax = tMin + 50;

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const v = tMax - ((tMax - tMin) * i) / 5;
      ctx.fillText(`${(v - 273.15).toFixed(0)}°C`, 4, y + 3);
    }
    for (let i = 0; i <= 4; i++) {
      const x = pad.l + (w * i) / 4;
      const r = (rMax * i) / 4;
      ctx.fillText(`${(r * 100).toFixed(1)}cm`, x - 12, height - 8);
    }
    ctx.fillStyle = "rgba(180,180,180,0.7)";
    ctx.fillText("radius →", pad.l + w - 60, pad.t - 4);

    for (const e of entries) {
      const st = e.state;
      const T = st ? picker(st) : null;
      if (!st || !T) continue;
      const R = st.r;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < T.length; i++) {
        const x = pad.l + (R[i] / rMax) * w;
        const norm = (T[i] - tMin) / (tMax - tMin);
        const y = pad.t + h * (1 - norm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [entries, picker, width, height]);
  return <canvas ref={ref} />;
}

interface MTimeBarProps {
  entries: CompareEntry[];
  picker: TimePicker;
  axisLabel: string; // y-axis title (e.g. "Time to ready (s)")
  width?: number;
  height?: number;
}

// Bars: one per pan, height = picker(state). Pans where picker returns null
// render as a dashed placeholder slot.
export function CompareMilestoneTimeBars({
  entries,
  picker,
  axisLabel,
  width = 520,
  height = 240,
}: MTimeBarProps) {
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
    const pad = { l: 48, r: 16, t: 16, b: 64 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    const data = entries.map((e) => ({
      e,
      v: e.state ? picker(e.state) : null,
    }));
    const maxV = Math.max(10, ...data.map((d) => d.v ?? 0));

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const v = maxV - (maxV * i) / 5;
      ctx.fillText(`${v.toFixed(0)}`, 4, y + 3);
    }

    if (data.length === 0) return;
    const slot = w / data.length;
    const barW = Math.min(56, slot * 0.6);
    data.forEach((d, i) => {
      const x = pad.l + slot * i + (slot - barW) / 2;
      if (d.v != null) {
        const bh = (d.v / maxV) * h;
        const y = pad.t + (h - bh);
        ctx.fillStyle = d.e.color;
        ctx.fillRect(x, y, barW, bh);
        ctx.fillStyle = "rgba(240,240,240,0.95)";
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${d.v.toFixed(1)} s`, x + barW / 2, y - 4);
      } else {
        ctx.strokeStyle = d.e.color;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x, pad.t + h - 6, barW, 6);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(200,200,200,0.55)";
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText("—", x + barW / 2, pad.t + h - 10);
      }
      ctx.fillStyle = "rgba(200,200,200,0.8)";
      ctx.font = "10px ui-monospace, monospace";
      const label = d.e.label.length > 18 ? d.e.label.slice(0, 17) + "…" : d.e.label;
      ctx.save();
      ctx.translate(x + barW / 2, pad.t + h + 8);
      ctx.rotate(-Math.PI / 6);
      ctx.textAlign = "right";
      ctx.fillText(label, 0, 8);
      ctx.restore();
    });
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(180,180,180,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(axisLabel, pad.l, pad.t - 4);
  }, [entries, picker, axisLabel, width, height]);
  return <canvas ref={ref} />;
}

interface MDeltaProps {
  entries: CompareEntry[];
  picker: SnapshotPicker; // returns top-row T at this milestone
  axisLabel: string; // e.g. "ΔT at ready (T_max − T_edge)"
  width?: number;
  height?: number;
}

// Bars: one per pan, height = T_max − T_edge computed from a snapshot.
export function CompareMilestoneDeltaBars({
  entries,
  picker,
  axisLabel,
  width = 520,
  height = 240,
}: MDeltaProps) {
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
    const pad = { l: 48, r: 16, t: 16, b: 64 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    const data = entries.map((e) => {
      const st = e.state;
      const T = st ? picker(st) : null;
      if (!st || !T || T.length === 0) return { e, delta: null as number | null };
      const nIn = st.nInner;
      let hi = -Infinity;
      for (let i = 0; i < nIn; i++) if (T[i] > hi) hi = T[i];
      const edge = T[nIn - 1];
      return { e, delta: Math.max(0, hi - edge) };
    });
    const maxDelta = Math.max(10, ...data.map((d) => d.delta ?? 0));

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.fillStyle = "rgba(220,220,220,0.6)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (h * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      const v = maxDelta - (maxDelta * i) / 5;
      ctx.fillText(`${v.toFixed(0)}°`, 4, y + 3);
    }

    if (data.length === 0) return;
    const slot = w / data.length;
    const barW = Math.min(56, slot * 0.6);
    data.forEach((d, i) => {
      const x = pad.l + slot * i + (slot - barW) / 2;
      if (d.delta != null) {
        const bh = (d.delta / maxDelta) * h;
        const y = pad.t + (h - bh);
        ctx.fillStyle = d.e.color;
        ctx.fillRect(x, y, barW, bh);
        ctx.fillStyle = "rgba(240,240,240,0.95)";
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${d.delta.toFixed(1)}°`, x + barW / 2, y - 4);
      } else {
        ctx.strokeStyle = d.e.color;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x, pad.t + h - 6, barW, 6);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(200,200,200,0.55)";
        ctx.font = "11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText("—", x + barW / 2, pad.t + h - 10);
      }
      ctx.fillStyle = "rgba(200,200,200,0.8)";
      ctx.font = "10px ui-monospace, monospace";
      const label = d.e.label.length > 18 ? d.e.label.slice(0, 17) + "…" : d.e.label;
      ctx.save();
      ctx.translate(x + barW / 2, pad.t + h + 8);
      ctx.rotate(-Math.PI / 6);
      ctx.textAlign = "right";
      ctx.fillText(label, 0, 8);
      ctx.restore();
    });
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(180,180,180,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(axisLabel, pad.l, pad.t - 4);
  }, [entries, picker, axisLabel, width, height]);
  return <canvas ref={ref} />;
}
