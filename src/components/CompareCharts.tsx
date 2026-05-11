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

    // domain
    let rMax = 0.001;
    let tMin = Infinity,
      tMax = -Infinity;
    for (const e of entries) {
      const T = e.state?.T;
      const R = e.state?.r;
      if (!T || !R) {
        tMin = Math.min(tMin, e.initialTempK);
        tMax = Math.max(tMax, e.initialTempK + 50);
        continue;
      }
      rMax = Math.max(rMax, R[R.length - 1]);
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
      const T = e.state?.T;
      let lo = Infinity,
        hi = -Infinity;
      if (T) {
        for (let i = 0; i < T.length; i++) {
          if (T[i] < lo) lo = T[i];
          if (T[i] > hi) hi = T[i];
        }
      } else {
        lo = e.initialTempK;
        hi = e.initialTempK;
      }
      return { e, delta: Math.max(0, hi - lo) };
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
    ctx.fillText("T_max − T_min across pan (°C)", pad.l, pad.t - 4);
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
