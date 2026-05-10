import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PanView } from "./PanView";
import { ProfileChart } from "./ProfileChart";
import { TempHistoryChart } from "./TempHistoryChart";
import { type SimState } from "@/lib/simulation";
import { type PanConfig, type HeaterConfig } from "@/lib/configs";
import { Pause, Play, RotateCcw, X } from "lucide-react";

interface Props {
  pans: PanConfig[];
  heaters: HeaterConfig[];
  panId: string;
  heaterId: string;
  onPanChange: (id: string) => void;
  onHeaterChange: (id: string) => void;
  state: SimState | null;
  initialTempK: number;
  // Optional overrides that force a shared scale across cards (Kelvin for
  // PanView/ProfileChart, Celsius for the time-history chart).
  profileRangeOverride?: { min: number; max: number };
  historyRangeCOverride?: { min: number; max: number };
  // Per-card simulation control.
  running: boolean;
  onRun: () => void;
  onPause: () => void;
  onReset: () => void;
  onRemove?: () => void;
  removable?: boolean;
}

export function SimCard({
  pans,
  heaters,
  panId,
  heaterId,
  onPanChange,
  onHeaterChange,
  state,
  initialTempK,
  profileRangeOverride,
  historyRangeCOverride,
  running,
  onRun,
  onPause,
  onReset,
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

  const Tarr = state?.T ?? new Float64Array([initialTempK]);
  const Rarr = state?.r ?? new Float64Array([0]);
  let tMinK = initialTempK;
  let tMaxK = tMinK + 1;
  for (let i = 0; i < Tarr.length; i++) if (Tarr[i] > tMaxK) tMaxK = Tarr[i];
  tMaxK = Math.max(tMaxK, tMinK + 50);
  if (profileRangeOverride) {
    tMinK = profileRangeOverride.min;
    tMaxK = profileRangeOverride.max;
  }

  // Stats below the chart should always reflect the actual values for this pan,
  // not the synced scale.
  const centerC = Tarr[0] - 273.15;
  const edgeC = Tarr[Tarr.length - 1] - 273.15;
  let peakC = -Infinity;
  for (let i = 0; i < Tarr.length; i++) if (Tarr[i] > peakC) peakC = Tarr[i];
  peakC = (Number.isFinite(peakC) ? peakC : initialTempK) - 273.15;

  return (
    <section className="panel p-5 space-y-4 min-w-[340px] xl:min-w-[680px] flex-1">
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

      <div className="flex flex-wrap items-center gap-2">
        {(() => {
          const steady = state?.steady === true;
          if (steady) {
            return (
              <Button size="sm" variant="ghost" disabled className="h-8">
                <Play className="w-3 h-3 mr-1.5" /> Steady
              </Button>
            );
          }
          if (running) {
            return (
              <Button size="sm" variant="secondary" onClick={onPause} className="h-8">
                <Pause className="w-3 h-3 mr-1.5" /> Pause
              </Button>
            );
          }
          return (
            <Button size="sm" onClick={onRun} className="h-8">
              <Play className="w-3 h-3 mr-1.5" /> Run
            </Button>
          );
        })()}
        <Button size="sm" variant="outline" onClick={onReset} className="h-8">
          <RotateCcw className="w-3 h-3 mr-1.5" /> Reset
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {(pan.diameter * 100).toFixed(0)} cm · {heater.power} W
        </span>
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">
            t = <span className="font-mono text-primary">{(state?.time ?? 0).toFixed(1)}s</span>
          </span>
        </div>
        <ProgressIndicators state={state} />
      </div>

      {/* Row 1: surface temperature (left) + radial profile (right).
          Row 2: single time-history chart spanning both columns. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="space-y-1 flex flex-col items-center">
          <div className="label-tag self-start">Surface temperature</div>
          <PanView
            T={Tarr}
            r={Rarr}
            panRadius={pan.diameter / 2 + pan.rimHeight}
            cookingRadius={pan.diameter / 2}
            heaterRadius={Math.min(heater.diameter / 2, pan.diameter / 2)}
            heaterThickness={heater.thickness}
            tMin={tMinK}
            tMax={tMaxK}
            tick={state?.time}
            size={220}
          />
        </div>
        <div className="space-y-1">
          <div className="label-tag">Radial profile</div>
          <ProfileChart
            T={Tarr}
            r={Rarr}
            tMin={tMinK}
            tMax={tMaxK}
            rOuter={pan.diameter / 2 + pan.rimHeight}
            tick={state?.time}
            width={260}
            height={180}
          />
        </div>
        <div className="space-y-1 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="label-tag">Top-surface temperature vs time</div>
            <TempHistoryLegend />
          </div>
          <TempHistoryChart
            state={state}
            initialTempK={initialTempK}
            yRangeCOverride={historyRangeCOverride}
            width={540}
            height={200}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="Center" value={`${centerC.toFixed(0)}°`} accent />
        <Stat label="Rim" value={`${edgeC.toFixed(0)}°`} />
        <Stat label="Peak" value={`${peakC.toFixed(0)}°`} />
      </div>
    </section>
  );
}

function ProgressIndicators({ state }: { state: SimState | null }) {
  const t = state?.time ?? 0;
  const cookingDone = state?.cookingReadyAtTime != null;
  const cookingTime = cookingDone ? (state?.cookingReadyAtTime ?? 0) : t;
  const steakActive = state?.steakActive === true;
  const steakDone = state?.steakDroppedAt != null;
  const steakTime = steakDone ? (state?.steakDroppedAt ?? 0) : t;
  const steakFlipped = state?.steakFlipped === true;
  const steakFlipTime = steakFlipped ? (state?.steakFlippedAt ?? 0) : t;
  const steakEnabled = state?.params?.steakEnabled === true;
  // "Steak cooked" is the simulation-halt moment (min(T_steak) ≥ done temp,
  // or limit-cycle convergence when no steak) — distinct from the FIRST
  // steady state (the steak-drop moment), which is shown above.
  const steadyDone = state?.steady === true;
  const steadyTime = steadyDone ? (state?.steadyAtTime ?? 0) : t;
  return (
    <div className="flex flex-col gap-0.5 font-mono">
      <span
        className={cookingDone ? "text-emerald-400" : "text-muted-foreground"}
        title="T_edge (cell at the cooking-zone outer edge) ≥ 150°C (Maillard threshold)"
      >
        ● Cooking ready = {cookingTime.toFixed(1)}s
      </span>
      {steakEnabled && (
        <span
          className={steakActive ? "text-emerald-400" : "text-muted-foreground"}
          title="Sim time at which the pan reached its first steady state and the steak was dropped"
        >
          ● Steak dropped = {steakTime.toFixed(1)}s
        </span>
      )}
      {steakEnabled && (
        <span
          className={steakFlipped ? "text-emerald-400" : "text-muted-foreground"}
          title="Sim time at which the steak's centre cell first reached 25°C and the steak was flipped (axial T reversal)"
        >
          ● Steak flipped = {steakFlipTime.toFixed(1)}s
        </span>
      )}
      <span
        className={steadyDone ? "text-emerald-400" : "text-muted-foreground"}
        title={
          steakActive
            ? "Steak cooked throughout — the coldest cell reached the done temperature"
            : "avg(min(T_center, T_edge)) over the last sliding window changed by ≤ 2% from the previous window"
        }
      >
        ● Steak cooked = {steadyTime.toFixed(1)}s
      </span>
    </div>
  );
}

function TempHistoryLegend() {
  return (
    <div className="flex gap-2 text-[10px] text-muted-foreground">
      <Swatch color="oklch(0.78 0.18 75)" label="center" />
      <Swatch color="oklch(0.7 0.2 25)" label="max" />
      <Swatch color="oklch(0.78 0.18 220)" label="edge" />
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-input/40 py-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`font-mono text-base ${accent ? "text-primary font-bold" : ""}`}>{value}</div>
    </div>
  );
}
