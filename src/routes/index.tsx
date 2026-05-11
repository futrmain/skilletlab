import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Play, Pause, RotateCcw, Plus, Flame } from "lucide-react";
import { usePanConfigs, useHeaterConfigs, uid, PAN_TEMPLATES } from "@/lib/configs";
import { PanEditor, HeaterEditor } from "@/components/ConfigEditors";
import { SimCard } from "@/components/SimCard";
import { EnergyCard } from "@/components/EnergyCard";
import { useSimulations, type SimInput } from "@/lib/useSimulations";
import {
  CompareLegend,
  CompareMilestoneProfileChart,
  CompareMilestoneTimeBars,
  CompareMilestoneDeltaBars,
  colorForIndex,
  type CompareEntry,
  type SnapshotPicker,
  type TimePicker,
} from "@/components/CompareCharts";
import { PanView } from "@/components/PanView";
import { formatSimTime } from "@/lib/format";

export const Route = createFileRoute("/")({
  component: Index,
});

interface SimSlot {
  key: string;
  panId: string;
  heaterId: string;
  running: boolean;
  resetTick: number;
}

function Index() {
  const [pans, setPans] = usePanConfigs();
  const [heaters, setHeaters] = useHeaterConfigs();

  const [ambient, setAmbient] = useState(20);
  const [hConv, setHConv] = useState(15);
  const [nrCells, setNrCells] = useState(120);
  const [nzPerLayer, setNzPerLayer] = useState(1);
  const [nzSteak, setNzSteak] = useState(8);
  const [dtSec, setDtSec] = useState(0.05);
  const [steadyWindowSec, setSteadyWindowSec] = useState(30);
  const [syncScales, setSyncScales] = useState(true);
  // Steak ("cooked food") global config — applies to every simulation slot.
  const [steakEnabled, setSteakEnabled] = useState(true);
  const [steakDiameterCm, setSteakDiameterCm] = useState(10);
  const [steakThicknessCm, setSteakThicknessCm] = useState(1.5);
  const [steakDensity, setSteakDensity] = useState(1050);
  const [steakInitialTempC, setSteakInitialTempC] = useState(5);
  const [steakDoneTempC, setSteakDoneTempC] = useState(55);

  // Default to the first 4 pan templates so each card starts on a distinct
  // pan even if the user has reshuffled or renamed their saved pans —
  // filledSlots below reconciles these against the live `pans` list.
  const [slots, setSlots] = useState<SimSlot[]>(() =>
    [0, 1, 2, 3].map((i) => ({
      key: uid(),
      panId: PAN_TEMPLATES[i]?.id ?? PAN_TEMPLATES[0]?.id ?? "",
      heaterId: "tpl-induction",
      running: false,
      resetTick: 0,
    })),
  );

  // Default-fill missing pan/heater ids when configs become available
  // When a slot's stored panId no longer matches any current pan (e.g. the
  // user has renamed/replaced pans in their saved config), fall back to the
  // first pan that no other slot has already claimed — this keeps the four
  // default cards on distinct pans rather than collapsing to pans[0].
  const filledSlots = (() => {
    const used = new Set<string>();
    return slots.map((s, idx) => {
      let panId = pans.find((p) => p.id === s.panId)?.id;
      if (!panId) {
        panId =
          pans.find((p) => !used.has(p.id))?.id ??
          pans[idx % Math.max(1, pans.length)]?.id ??
          "";
      }
      if (panId) used.add(panId);
      return {
        ...s,
        panId,
        heaterId:
          heaters.find((h) => h.id === s.heaterId)?.id ??
          heaters.find((h) => h.id === "tpl-induction")?.id ??
          heaters[0]?.id ??
          "",
      };
    });
  })();

  const inputs: SimInput[] = useMemo(() => {
    return filledSlots.flatMap((s) => {
      const pan = pans.find((p) => p.id === s.panId);
      const heater = heaters.find((h) => h.id === s.heaterId);
      if (!pan || !heater) return [];
      return [
        {
          key: s.key,
          panRadius: pan.diameter / 2,
          rimHeight: pan.rimHeight,
          rimReturnFraction: pan.rimReturnFraction ?? 0.5,
          layers: pan.layers,
          heaterRadius: Math.min(heater.diameter / 2, pan.diameter / 2),
          heaterThickness: heater.thickness,
          heaterPower: heater.power,
          setpointHigh: heater.setpointHigh + 273.15,
          setpointLow: heater.setpointLow + 273.15,
          ambient: ambient + 273.15,
          hConv,
          initialTemp: ambient + 273.15,
          nr: nrCells,
          nzPerLayer,
          dt: dtSec,
          steadyWindowSec,
          steakEnabled,
          steakRadius: steakDiameterCm / 2 / 100,
          steakThickness: steakThicknessCm / 100,
          steakDensity,
          steakCp: 3500, // J/(kg·K) — typical raw beef
          steakK: 0.48, // W/(m·K) — typical raw beef
          steakInitialTemp: steakInitialTempC + 273.15,
          steakEmissivity: 0.95,
          nzSteak,
          steakDoneTemp: steakDoneTempC + 273.15,
          running: s.running,
          resetTick: s.resetTick,
        },
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(filledSlots),
    pans,
    heaters,
    ambient,
    hConv,
    nrCells,
    nzPerLayer,
    nzSteak,
    dtSec,
    steadyWindowSec,
    steakEnabled,
    steakDiameterCm,
    steakThicknessCm,
    steakDensity,
    steakInitialTempC,
    steakDoneTempC,
  ]);

  const snapshots = useSimulations(inputs);
  const snapByKey = new Map(snapshots.map((s) => [s.key, s]));

  // Whether any slot is actively being stepped right now (a running, non-steady slot).
  const anyRunning = filledSlots.some((s) => {
    const steady = snapByKey.get(s.key)?.state?.steady === true;
    return s.running && !steady;
  });

  // Stop a slot's run flag once its sim reaches steady (UI cleanup).
  useEffect(() => {
    setSlots((ss) => {
      let changed = false;
      const next = ss.map((s) => {
        const steady = snapByKey.get(s.key)?.state?.steady === true;
        if (s.running && steady) {
          changed = true;
          return { ...s, running: false };
        }
        return s;
      });
      return changed ? next : ss;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(snapshots.map((s) => `${s.key}:${s.state?.steady}`))]);

  const updateSlot = (key: string, patch: Partial<SimSlot>) =>
    setSlots((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const addSlot = () =>
    setSlots((s) => [
      ...s,
      {
        key: uid(),
        panId: pans[0]?.id ?? "",
        heaterId: heaters.find((h) => h.id === "tpl-induction")?.id ?? heaters[0]?.id ?? "",
        running: false,
        resetTick: 0,
      },
    ]);
  const removeSlot = (key: string) =>
    setSlots((s) => (s.length > 1 ? s.filter((x) => x.key !== key) : s));

  // Per-slot run/pause/reset.
  const runSlot = (key: string) =>
    setSlots((ss) => ss.map((s) => (s.key === key ? { ...s, running: true } : s)));
  const pauseSlot = (key: string) =>
    setSlots((ss) => ss.map((s) => (s.key === key ? { ...s, running: false } : s)));
  const resetSlot = (key: string) =>
    setSlots((ss) =>
      ss.map((s) => (s.key === key ? { ...s, running: false, resetTick: s.resetTick + 1 } : s)),
    );

  // Global helpers used by the main toolbar.
  const runAll = () =>
    setSlots((ss) =>
      ss.map((s) => {
        const steady = snapByKey.get(s.key)?.state?.steady === true;
        return steady ? s : { ...s, running: true };
      }),
    );
  const pauseAll = () =>
    setSlots((ss) => ss.map((s) => (s.running ? { ...s, running: false } : s)));
  const resetAll = () =>
    setSlots((ss) => ss.map((s) => ({ ...s, running: false, resetTick: s.resetTick + 1 })));

  const initialTempK = ambient + 273.15;

  // Global ranges for the "sync scales" toggle. Two distinct ranges because the
  // PanView heatmap + radial profile show *current* T whereas the temperature-
  // history chart spans the full Tedge/Tmax trajectory; using one range for both
  // would either wash out the heatmap colors or clip the history.
  let syncProfileMinK = initialTempK;
  let syncProfileMaxK = initialTempK + 50;
  let syncHistMinC = Infinity;
  let syncHistMaxC = -Infinity;
  if (syncScales) {
    for (const snap of snapshots) {
      const T = snap.state?.T;
      if (T) {
        for (let i = 0; i < T.length; i++) {
          if (T[i] < syncProfileMinK) syncProfileMinK = T[i];
          if (T[i] > syncProfileMaxK) syncProfileMaxK = T[i];
        }
      }
      const h = snap.state?.history ?? [];
      for (const sm of h) {
        const edgeC = sm.Tedge - 273.15;
        const maxC = sm.Tmax - 273.15;
        if (edgeC < syncHistMinC) syncHistMinC = edgeC;
        if (maxC > syncHistMaxC) syncHistMaxC = maxC;
      }
    }
    syncProfileMaxK = Math.max(syncProfileMaxK, syncProfileMinK + 50);
  }
  const syncedProfileRange = syncScales
    ? { min: syncProfileMinK, max: syncProfileMaxK }
    : undefined;
  const syncedHistRangeC =
    syncScales && Number.isFinite(syncHistMinC) && Number.isFinite(syncHistMaxC)
      ? { min: syncHistMinC, max: syncHistMaxC }
      : undefined;

  const compareEntries: CompareEntry[] = filledSlots.map((s, i) => {
    const pan = pans.find((p) => p.id === s.panId);
    const heater = heaters.find((h) => h.id === s.heaterId);
    return {
      key: s.key,
      label: pan && heater ? `${pan.name} · ${heater.name}` : "—",
      state: snapByKey.get(s.key)?.state ?? null,
      initialTempK,
      color: colorForIndex(i),
    };
  });

  return (
    <main className="min-h-screen px-4 py-6 md:px-8 md:py-10 max-w-[1600px] mx-auto">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="label-tag mb-2 flex items-center gap-2">
            <Flame className="w-3 h-3" /> skilletlab.dev
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            Skilletlab<span className="text-primary">.</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-xl">
            Define pans and heaters, then run side-by-side axisymmetric heat diffusion simulations
            directly in your browser.
          </p>
        </div>
      </header>

      <Tabs defaultValue="simulate" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="simulate">Simulate</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
          <TabsTrigger value="pans">Pans ({pans.length})</TabsTrigger>
          <TabsTrigger value="heaters">Heaters ({heaters.length})</TabsTrigger>
          <TabsTrigger value="energy">Energy balance</TabsTrigger>
          <TabsTrigger value="cooking">Cooking</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
          <TabsTrigger value="solver">Solver</TabsTrigger>
        </TabsList>

        <TabsContent value="simulate" className="space-y-4">
          <Toolbar
            anyRunning={anyRunning}
            onRunAll={runAll}
            onPauseAll={pauseAll}
            onResetAll={resetAll}
            onAdd={addSlot}
            ambient={ambient}
            hConv={hConv}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer w-fit">
            <Checkbox checked={syncScales} onCheckedChange={(v) => setSyncScales(v === true)} />
            Sync y-scales and colorbars across simulations
          </label>
          <div className="flex flex-wrap gap-4 items-stretch">
            {filledSlots.map((s) => (
              <SimCard
                key={s.key}
                pans={pans}
                heaters={heaters}
                panId={s.panId}
                heaterId={s.heaterId}
                onPanChange={(id) => updateSlot(s.key, { panId: id })}
                onHeaterChange={(id) => updateSlot(s.key, { heaterId: id })}
                state={snapByKey.get(s.key)?.state ?? null}
                initialTempK={initialTempK}
                profileRangeOverride={syncedProfileRange}
                historyRangeCOverride={syncedHistRangeC}
                running={s.running}
                onRun={() => runSlot(s.key)}
                onPause={() => pauseSlot(s.key)}
                onReset={() => resetSlot(s.key)}
                removable={filledSlots.length > 1}
                onRemove={() => removeSlot(s.key)}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="compare" className="space-y-6">
          <Toolbar
            anyRunning={anyRunning}
            onRunAll={runAll}
            onPauseAll={pauseAll}
            onResetAll={resetAll}
            onAdd={addSlot}
            ambient={ambient}
            hConv={hConv}
          />

          {compareEntries.length === 0 ? (
            <section className="panel p-5 text-sm text-muted-foreground">
              Add at least one simulation in the Simulate tab.
            </section>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <MilestoneSection
                title="Ready to cook"
                description="Top-surface temperatures captured the moment T_edge crossed the Maillard threshold (150 °C)."
                entries={compareEntries}
                snapshotPicker={(s) => s.tempProfileReady}
                timePicker={(s) => s.cookingReadyAtTime}
              />
              <MilestoneSection
                title="Steady state"
                description="Top-surface temperatures captured at the FIRST steady state — the moment the pan reaches its limit cycle and the steak is dropped (or limit-cycle convergence with no steak)."
                entries={compareEntries}
                snapshotPicker={(s) => s.tempProfileSteady}
                timePicker={(s) => s.steakDroppedAt ?? s.steadyAtTime}
              />
              <MilestoneSection
                title="Local minimum after steak drop"
                description="Top-surface temperatures at the running minimum of T_center observed during the steak phase. Captures the worst-case 'cold-shock' the cooking surface takes when the cold steak first touches it."
                entries={compareEntries}
                snapshotPicker={(s) => s.tempProfileLocalMin}
                timePicker={(s) => s.localMinAfterSteakAtTime}
              />

              <section className="panel p-5 space-y-3">
                <div className="label-tag mb-2">Comparison metrics</div>
                <CompareLegend entries={compareEntries} />
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <div className="label-tag">Time to ready (s)</div>
                    <CompareMilestoneTimeBars
                      entries={compareEntries}
                      picker={(s) => s.cookingReadyAtTime}
                      axisLabel="Time to ready (s)"
                      width={Math.max(360, compareEntries.length * 90 + 100)}
                      height={200}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="label-tag">Time to steady (s)</div>
                    <CompareMilestoneTimeBars
                      entries={compareEntries}
                      picker={(s) => s.steakDroppedAt ?? s.steadyAtTime}
                      axisLabel="Time to steady (s)"
                      width={Math.max(360, compareEntries.length * 90 + 100)}
                      height={200}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="label-tag">ΔT at ready (°C)</div>
                    <CompareMilestoneDeltaBars
                      entries={compareEntries}
                      picker={(s) => s.tempProfileReady}
                      axisLabel="T_max − T_edge at ready"
                      width={Math.max(360, compareEntries.length * 90 + 100)}
                      height={200}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="label-tag">ΔT at steady (°C)</div>
                    <CompareMilestoneDeltaBars
                      entries={compareEntries}
                      picker={(s) => s.tempProfileSteady}
                      axisLabel="T_max − T_edge at steady"
                      width={Math.max(360, compareEntries.length * 90 + 100)}
                      height={200}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="label-tag">ΔT at local min (°C)</div>
                    <CompareMilestoneDeltaBars
                      entries={compareEntries}
                      picker={(s) => s.tempProfileLocalMin}
                      axisLabel="T_max − T_edge at local min"
                      width={Math.max(360, compareEntries.length * 90 + 100)}
                      height={200}
                    />
                  </div>
                </div>
              </section>
            </div>
          )}
        </TabsContent>

        <TabsContent value="energy" className="space-y-4">
          <Toolbar
            anyRunning={anyRunning}
            onRunAll={runAll}
            onPauseAll={pauseAll}
            onResetAll={resetAll}
            onAdd={addSlot}
            ambient={ambient}
            hConv={hConv}
          />
          <div className="flex flex-wrap gap-4 items-stretch">
            {filledSlots.map((s) => (
              <EnergyCard
                key={s.key}
                pans={pans}
                heaters={heaters}
                panId={s.panId}
                heaterId={s.heaterId}
                onPanChange={(id) => updateSlot(s.key, { panId: id })}
                onHeaterChange={(id) => updateSlot(s.key, { heaterId: id })}
                state={snapByKey.get(s.key)?.state ?? null}
                removable={filledSlots.length > 1}
                onRemove={() => removeSlot(s.key)}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="pans">
          <PanEditor pans={pans} setPans={setPans} />
        </TabsContent>

        <TabsContent value="heaters">
          <HeaterEditor heaters={heaters} setHeaters={setHeaters} />
        </TabsContent>

        <TabsContent value="environment">
          <section className="panel p-5 max-w-md space-y-3">
            <div className="label-tag mb-2">Environment (applies to all simulations)</div>
            <NumberField
              label="Ambient temperature (°C)"
              value={ambient}
              step={1}
              min={-20}
              max={50}
              onChange={setAmbient}
            />
            <NumberField
              label="Convection h (W/m²·K)"
              value={hConv}
              step={1}
              min={1}
              max={100}
              onChange={setHConv}
            />
            <p className="text-xs text-muted-foreground pt-2">
              These settings model the air above the pan: convective cooling from the top surface.
              Radiative loss from the top uses the emissivity of the topmost material layer.
            </p>
          </section>
        </TabsContent>

        <TabsContent value="cooking">
          <section className="panel p-5 max-w-md space-y-3">
            <div className="label-tag mb-2">Steak (applies to all simulations)</div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer w-fit">
              <Checkbox
                checked={steakEnabled}
                onCheckedChange={(v) => setSteakEnabled(v === true)}
              />
              Drop a steak when the pan reaches steady state
            </label>
            <NumberField
              label="Diameter (cm)"
              value={steakDiameterCm}
              step={0.5}
              min={1}
              max={40}
              onChange={setSteakDiameterCm}
            />
            <NumberField
              label="Thickness (cm)"
              value={steakThicknessCm}
              step={0.1}
              min={0.5}
              max={10}
              onChange={setSteakThicknessCm}
            />
            <NumberField
              label="Density (kg/m³)"
              value={steakDensity}
              step={10}
              min={500}
              max={1500}
              onChange={setSteakDensity}
            />
            <NumberField
              label="Starting temperature (°C)"
              value={steakInitialTempC}
              step={1}
              min={-20}
              max={30}
              onChange={setSteakInitialTempC}
            />
            <NumberField
              label="Done temperature (°C)"
              value={steakDoneTempC}
              step={1}
              min={30}
              max={100}
              onChange={setSteakDoneTempC}
            />
            <div className="text-xs text-muted-foreground pt-2">
              Mass:{" "}
              <span className="font-mono text-primary">
                {(
                  steakDensity *
                  Math.PI *
                  Math.pow(steakDiameterCm / 200, 2) *
                  (steakThicknessCm / 100) *
                  1000
                ).toFixed(0)}{" "}
                g
              </span>{" "}
              (ρ · π·R²·h, with R = D/2). Beef bulk properties (k = 0.48 W/m·K, c = 3500 J/kg·K, ε =
              0.95) are baked in.
            </div>
            <p className="text-xs text-muted-foreground">
              The steak is modelled as an axisymmetric cylinder centred on the pan. It is dropped
              onto the cooking surface the moment the pan first reaches its limit-cycle steady
              state. The simulation continues until the steak is <em>cooked throughout</em>, i.e.
              its coldest cell reaches the done temperature above (≈ 50 °C rare, 55 °C medium-rare,
              63 °C medium, 70 °C+ well-done).
            </p>
          </section>
        </TabsContent>

        <TabsContent value="solver">
          <section className="panel p-5 max-w-md space-y-3">
            <div className="label-tag mb-2">Solver mesh (applies to all simulations)</div>
            <NumberField
              label="Radial cells"
              value={nrCells}
              step={10}
              min={20}
              max={500}
              onChange={setNrCells}
            />
            <NumberField
              label="Axial cells per material layer"
              value={nzPerLayer}
              step={1}
              min={1}
              max={20}
              onChange={setNzPerLayer}
            />
            <NumberField
              label="Axial cells in steak"
              value={nzSteak}
              step={1}
              min={1}
              max={32}
              onChange={setNzSteak}
            />
            <NumberField
              label="Time step dt (s)"
              value={dtSec}
              step={0.01}
              min={0.001}
              max={5}
              onChange={setDtSec}
            />
            <NumberField
              label="Steady-state window (s)"
              value={steadyWindowSec}
              step={5}
              min={1}
              max={600}
              onChange={setSteadyWindowSec}
            />
            <p className="text-xs text-muted-foreground pt-2">
              The solver is a 2D axisymmetric finite-volume scheme on a (z, r) grid, integrated in
              time with implicit Crank–Nicolson via Peaceman–Rachford ADI (each half-step is a
              tridiagonal solve). The scheme is unconditionally stable, so dt is bounded by
              accuracy, not stability — too large a step can ring around the heater
              cut-off/re-ignite events. Changes restart the simulation.
            </p>
            <p className="text-xs text-muted-foreground">
              Stopping criterion (two phases when a steak is enabled):
              <br />
              <strong>Phase A</strong> — pan steady on a sliding window. Time-integrate{" "}
              <span className="font-mono">min(T_center, T_edge)</span> (top-surface cells at the
              cooking-zone centre and outer edge — whichever is colder) over each non-overlapping{" "}
              <span className="font-mono">steadyWindowSec</span> window. When the average of two
              consecutive windows differs by{" "}
              <span className="font-mono">≤ 2%</span>, the pan is steady. With no steak, this is the
              final criterion.
              <br />
              <strong>Phase B</strong> (only when a steak is enabled) — steak cooked through. The
              steak is dropped at the end of Phase A and the simulation continues until the coldest
              cell anywhere in the steak reaches the done temperature set on the Cooking tab.{" "}
              <span className="font-mono">state.steady</span> latches at that moment.
            </p>
          </section>

          <section className="panel p-5 max-w-2xl space-y-3 mt-4">
            <div className="label-tag mb-2">Per-simulation diagnostics</div>
            <p className="text-xs text-muted-foreground">
              Per-cell <span className="font-mono">Fourier number</span>{" "}
              <span className="font-mono">Fo = α·dt/Δx²</span> with{" "}
              <span className="font-mono">α = k/(ρ·c)</span>. Pure diffusion has no advective CFL —
              Fo gates Crank–Nicolson&apos;s accuracy and ringing tendency, not its stability.
              Reference: <span className="text-emerald-400">Fo ≲ 2 clean</span>,{" "}
              <span className="text-amber-400">2–5 acceptable</span>,{" "}
              <span className="text-red-400">&gt; 5 ringing risk</span> (especially around layer
              interfaces and heater toggle events). If you see a red cell, lower{" "}
              <span className="font-mono">dt</span> or reduce{" "}
              <span className="font-mono">nzPerLayer</span> for that layer.
            </p>
            {filledSlots.length === 0 ? (
              <div className="text-xs text-muted-foreground">No simulations.</div>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                  <span>Pan · Heater</span>
                  <span className="text-right">max Fo_r</span>
                  <span className="text-right">max Fo_z</span>
                </div>
                {filledSlots.map((s) => {
                  const pan = pans.find((p) => p.id === s.panId);
                  const heater = heaters.find((h) => h.id === s.heaterId);
                  const st = snapByKey.get(s.key)?.state;
                  return (
                    <div
                      key={s.key}
                      className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center"
                    >
                      <span className="truncate">
                        {pan?.name ?? "—"} · {heater?.name ?? "—"}
                      </span>
                      <span className={`text-right font-mono ${foClass(st?.maxFoR)}`}>
                        {st ? st.maxFoR.toFixed(2) : "—"}
                      </span>
                      <span className={`text-right font-mono ${foClass(st?.maxFoZ)}`}>
                        {st ? st.maxFoZ.toFixed(2) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <footer className="mt-12 text-center text-xs text-muted-foreground">
        2D axisymmetric finite-volume · simulating in your browser
      </footer>
    </main>
  );
}

function Toolbar({
  anyRunning,
  onRunAll,
  onPauseAll,
  onResetAll,
  onAdd,
  ambient,
  hConv,
}: {
  anyRunning: boolean;
  onRunAll: () => void;
  onPauseAll: () => void;
  onResetAll: () => void;
  onAdd: () => void;
  ambient: number;
  hConv: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={anyRunning ? onPauseAll : onRunAll}
        size="lg"
        variant={anyRunning ? "secondary" : "default"}
        title={
          anyRunning
            ? "Pause every simulation that is currently running"
            : "Run every simulation that has not yet reached steady state"
        }
      >
        {anyRunning ? (
          <>
            <Pause className="w-4 h-4 mr-2" /> Pause
          </>
        ) : (
          <>
            <Play className="w-4 h-4 mr-2" /> Run
          </>
        )}
      </Button>
      <Button onClick={onResetAll} size="lg" variant="outline">
        <RotateCcw className="w-4 h-4 mr-2" /> Reset
      </Button>
      <Button onClick={onAdd} size="lg" variant="outline">
        <Plus className="w-4 h-4 mr-2" /> Add side-by-side
      </Button>
      <div className="text-xs text-muted-foreground ml-auto">
        Ambient {ambient}°C · h={hConv} W/m²K
      </div>
    </div>
  );
}

function MilestoneSection({
  title,
  description,
  entries,
  snapshotPicker,
  timePicker,
}: {
  title: string;
  description: string;
  entries: CompareEntry[];
  snapshotPicker: SnapshotPicker;
  timePicker: TimePicker;
}) {
  // Synced colourbar range across all pans for THIS milestone.
  let mTMin = Infinity;
  let mTMax = -Infinity;
  for (const e of entries) {
    const T = e.state ? snapshotPicker(e.state) : null;
    if (!T) continue;
    for (let i = 0; i < T.length; i++) {
      if (T[i] < mTMin) mTMin = T[i];
      if (T[i] > mTMax) mTMax = T[i];
    }
  }
  if (!Number.isFinite(mTMin)) {
    mTMin = 293.15;
    mTMax = 343.15;
  }
  if (mTMax - mTMin < 50) mTMax = mTMin + 50;

  return (
    <section className="panel p-5 space-y-3">
      <div className="label-tag">{title}</div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex flex-wrap gap-3">
        {entries.map((e) => {
          const st = e.state;
          const snap = st ? snapshotPicker(st) : null;
          const tAt = st ? timePicker(st) : null;
          return (
            <div key={e.key} className="flex flex-col items-center gap-1 text-xs">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: e.color }}
                />
                <span className="text-foreground">{e.label}</span>
              </span>
              <span className="text-muted-foreground font-mono">
                {tAt != null ? `t = ${formatSimTime(tAt)}` : "—"}
              </span>
              {snap && st ? (
                <PanView
                  T={snap}
                  r={st.r}
                  panRadius={st.params.panRadius + st.params.rimHeight}
                  cookingRadius={st.params.panRadius}
                  heaterRadius={Math.min(st.params.heaterRadius, st.params.panRadius)}
                  heaterThickness={st.params.heaterThickness}
                  tMin={mTMin}
                  tMax={mTMax}
                  tick={tAt ?? 0}
                  size={140}
                />
              ) : (
                <div
                  className="flex items-center justify-center text-xs text-muted-foreground italic border border-dashed border-border rounded-md"
                  style={{ width: 184, height: 140 }}
                >
                  Not yet captured
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="overflow-x-auto">
        <CompareMilestoneProfileChart
          entries={entries}
          picker={snapshotPicker}
          width={Math.max(420, entries.length * 50 + 360)}
          height={260}
        />
      </div>
    </section>
  );
}

function foClass(fo: number | undefined): string {
  if (fo === undefined) return "text-muted-foreground";
  if (fo > 5) return "text-red-400";
  if (fo > 2) return "text-amber-400";
  return "text-emerald-400";
}

function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="h-8 text-sm font-mono"
      />
    </div>
  );
}
