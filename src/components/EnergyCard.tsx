import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type SimState } from "@/lib/simulation";
import { type PanConfig, type HeaterConfig } from "@/lib/configs";
import { X } from "lucide-react";

interface Props {
  pans: PanConfig[];
  heaters: HeaterConfig[];
  panId: string;
  heaterId: string;
  onPanChange: (id: string) => void;
  onHeaterChange: (id: string) => void;
  state: SimState | null;
  onRemove?: () => void;
  removable?: boolean;
}

const COL = {
  input: "oklch(0.78 0.18 75)", // amber — heater input
  stored: "oklch(0.7 0.18 150)", // green — stored in pan
  conv: "oklch(0.78 0.18 220)", // blue — convection
  rad: "oklch(0.7 0.2 25)", // red — radiation
};

export function EnergyCard({
  pans,
  heaters,
  panId,
  heaterId,
  onPanChange,
  onHeaterChange,
  state,
  onRemove,
  removable,
}: Props) {
  const pan = pans.find((p) => p.id === panId);
  const heater = heaters.find((h) => h.id === heaterId);

  if (!pan || !heater) {
    return (
      <section className="panel p-5 text-sm text-muted-foreground min-w-[340px] flex-1">
        Select a pan and heater.
      </section>
    );
  }

  return (
    <section className="panel p-5 space-y-4 min-w-[340px] flex-1">
      <div className="flex items-start gap-2">
        <div className="grid grid-cols-1 gap-2 flex-1">
          <div>
            <div className="label-tag mb-1">Pan</div>
            <Select value={pan.id} onValueChange={onPanChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="label-tag mb-1">Heater</div>
            <Select value={heater.id} onValueChange={onHeaterChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {heaters.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {removable && (
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onRemove}>
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          t = <span className="font-mono text-primary">{(state?.time ?? 0).toFixed(1)}s</span>
        </span>
        <Legend />
      </div>

      <EnergyChart state={state} width={340} height={170} />

      <div className="text-xs text-muted-foreground">
        Conservation residual <span className="font-mono">|E_in − E_stored − E_conv − E_rad|</span>{" "}
        (log scale)
      </div>
      <ResidualChart state={state} width={340} height={140} />
    </section>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-2 text-[10px]">
      <Swatch color={COL.input} label="input" />
      <Swatch color={COL.stored} label="stored" />
      <Swatch color={COL.conv} label="conv" />
      <Swatch color={COL.rad} label="rad" />
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function EnergyChart({
  state,
  width,
  height,
}: {
  state: SimState | null;
  width: number;
  height: number;
}) {
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

    const pad = { l: 50, r: 8, t: 8, b: 22 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    const hist = state?.history ?? [];
    if (hist.length < 2) {
      drawAxes(ctx, pad, w, h, "0", "0", "0 s", "0 s");
      return;
    }

    const tMax = Math.max(1e-3, hist[hist.length - 1].t);
    let yMax = 1e-9;
    for (const s of hist) {
      if (s.eIn > yMax) yMax = s.eIn;
      if (s.eStored > yMax) yMax = s.eStored;
      if (s.eConv > yMax) yMax = s.eConv;
      if (s.eRad > yMax) yMax = s.eRad;
    }
    if (yMax < 1) yMax = 1;

    drawAxes(ctx, pad, w, h, `${(yMax / 1000).toFixed(1)} kJ`, "0", `${tMax.toFixed(1)} s`, "0 s");

    const xOf = (t: number) => pad.l + (t / tMax) * w;
    const yOf = (e: number) => pad.t + h * (1 - e / yMax);

    drawLine(ctx, hist, xOf, yOf, (s) => s.eIn, COL.input);
    drawLine(ctx, hist, xOf, yOf, (s) => s.eStored, COL.stored);
    drawLine(ctx, hist, xOf, yOf, (s) => s.eConv, COL.conv);
    drawLine(ctx, hist, xOf, yOf, (s) => s.eRad, COL.rad);
  }, [state, width, height]);

  return <canvas ref={ref} />;
}

function ResidualChart({
  state,
  width,
  height,
}: {
  state: SimState | null;
  width: number;
  height: number;
}) {
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

    const pad = { l: 50, r: 8, t: 8, b: 22 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;

    const hist = state?.history ?? [];
    if (hist.length < 2) {
      drawAxes(ctx, pad, w, h, "—", "—", "0 s", "0 s");
      return;
    }

    const tMax = Math.max(1e-3, hist[hist.length - 1].t);

    // |residual|, skipping zeros for log
    let logMin = Infinity;
    let logMax = -Infinity;
    const points: { t: number; lr: number }[] = [];
    for (const s of hist) {
      const r = Math.abs(s.eIn - s.eStored - s.eConv - s.eRad);
      if (!(r > 0 && Number.isFinite(r))) continue;
      const lr = Math.log10(r);
      if (lr < logMin) logMin = lr;
      if (lr > logMax) logMax = lr;
      points.push({ t: s.t, lr });
    }
    if (!Number.isFinite(logMin) || !Number.isFinite(logMax)) {
      drawAxes(ctx, pad, w, h, "—", "—", `${tMax.toFixed(1)} s`, "0 s");
      return;
    }
    if (logMax - logMin < 1) {
      logMax = logMin + 1;
    }
    // Pad a bit
    logMin = Math.floor(logMin) - 0.5;
    logMax = Math.ceil(logMax) + 0.5;

    drawAxes(
      ctx,
      pad,
      w,
      h,
      `1e${logMax.toFixed(0)}`,
      `1e${logMin.toFixed(0)}`,
      `${tMax.toFixed(1)} s`,
      "0 s",
    );

    // log-decade gridlines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let d = Math.ceil(logMin); d <= Math.floor(logMax); d++) {
      const y = pad.t + h * (1 - (d - logMin) / (logMax - logMin));
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(180,180,180,0.55)";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(`1e${d}`, 4, y + 3);
    }

    const xOf = (t: number) => pad.l + (t / tMax) * w;
    const yOf = (lr: number) => pad.t + h * (1 - (lr - logMin) / (logMax - logMin));

    ctx.strokeStyle = "oklch(0.85 0.02 230)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const x = xOf(points[i].t);
      const y = yOf(points[i].lr);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [state, width, height]);

  return <canvas ref={ref} />;
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  pad: { l: number; r: number; t: number; b: number },
  w: number,
  h: number,
  yTopLabel: string,
  yBotLabel: string,
  xRightLabel: string,
  xLeftLabel: string,
) {
  // background grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(220,220,220,0.6)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(yTopLabel, 4, pad.t + 8);
  ctx.fillText(yBotLabel, 4, pad.t + h);
  ctx.fillText(xLeftLabel, pad.l - 2, pad.t + h + 14);
  ctx.fillText(xRightLabel, pad.l + w - 36, pad.t + h + 14);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  hist: { t: number; eIn: number; eStored: number; eConv: number; eRad: number }[],
  xOf: (t: number) => number,
  yOf: (e: number) => number,
  pick: (s: { t: number; eIn: number; eStored: number; eConv: number; eRad: number }) => number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.75;
  ctx.beginPath();
  for (let i = 0; i < hist.length; i++) {
    const s = hist[i];
    const x = xOf(s.t);
    const y = yOf(pick(s));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
