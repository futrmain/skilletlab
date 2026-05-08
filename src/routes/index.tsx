import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Play, Pause, RotateCcw, Plus, Flame } from "lucide-react";
import { usePanConfigs, useHeaterConfigs, uid } from "@/lib/configs";
import { PanEditor, HeaterEditor } from "@/components/ConfigEditors";
import { SimCard } from "@/components/SimCard";
import { EnergyCard } from "@/components/EnergyCard";
import { useSimulations, type SimInput } from "@/lib/useSimulations";
import {
  CompareProfileChart,
  CompareDeltaBars,
  CompareLegend,
  colorForIndex,
  type CompareEntry,
} from "@/components/CompareCharts";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Skillet — Frying Pan Heat Simulator" },
      {
        name: "description",
        content:
          "Browser-based axisymmetric heat diffusion simulator for multi-layer frying pans on circular heaters. Compare configurations side by side.",
      },
    ],
  }),
});

interface SimSlot {
  key: string;
  panId: string;
  heaterId: string;
}

function Index() {
  const [pans, setPans] = usePanConfigs();
  const [heaters, setHeaters] = useHeaterConfigs();

  const [ambient, setAmbient] = useState(20);
  const [hConv, setHConv] = useState(15);
  const [nrCells, setNrCells] = useState(120);
  const [nzPerLayer, setNzPerLayer] = useState(1);
  const [running, setRunning] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  const [slots, setSlots] = useState<SimSlot[]>(() => [
    {
      key: uid(),
      panId: "",
      heaterId: "",
    },
  ]);

  // Default-fill missing pan/heater ids when configs become available
  const filledSlots = slots.map((s) => ({
    ...s,
    panId: pans.find((p) => p.id === s.panId)?.id ?? pans[0]?.id ?? "",
    heaterId: heaters.find((h) => h.id === s.heaterId)?.id ?? heaters[0]?.id ?? "",
  }));

  const inputs: SimInput[] = useMemo(() => {
    return filledSlots.flatMap((s) => {
      const pan = pans.find((p) => p.id === s.panId);
      const heater = heaters.find((h) => h.id === s.heaterId);
      if (!pan || !heater) return [];
      return [
        {
          key: s.key,
          panRadius: pan.diameter / 2,
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
        },
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filledSlots), pans, heaters, ambient, hConv, nrCells, nzPerLayer]);

  const snapshots = useSimulations(inputs, running, resetSignal);
  const snapByKey = new Map(snapshots.map((s) => [s.key, s]));

  const updateSlot = (key: string, patch: Partial<SimSlot>) =>
    setSlots((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const addSlot = () =>
    setSlots((s) => [
      ...s,
      {
        key: uid(),
        panId: pans[0]?.id ?? "",
        heaterId: heaters[0]?.id ?? "",
      },
    ]);
  const removeSlot = (key: string) =>
    setSlots((s) => (s.length > 1 ? s.filter((x) => x.key !== key) : s));

  const initialTempK = ambient + 273.15;

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
            <Flame className="w-3 h-3" /> Thermal Lab · v2
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            Skillet<span className="text-primary">.</span>
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
          <TabsTrigger value="environment">Environment</TabsTrigger>
          <TabsTrigger value="solver">Solver</TabsTrigger>
        </TabsList>

        <TabsContent value="simulate" className="space-y-4">
          <Toolbar
            running={running}
            setRunning={setRunning}
            onReset={() => {
              setRunning(false);
              setResetSignal((n) => n + 1);
            }}
            onAdd={addSlot}
            ambient={ambient}
            hConv={hConv}
          />
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
                removable={filledSlots.length > 1}
                onRemove={() => removeSlot(s.key)}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="compare" className="space-y-6">
          <Toolbar
            running={running}
            setRunning={setRunning}
            onReset={() => {
              setRunning(false);
              setResetSignal((n) => n + 1);
            }}
            onAdd={addSlot}
            ambient={ambient}
            hConv={hConv}
          />

          {compareEntries.length === 0 ? (
            <section className="panel p-5 text-sm text-muted-foreground">
              Add at least one simulation in the Simulate tab.
            </section>
          ) : (
            <>
              <section className="panel p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="label-tag">Radial Temperature Profiles</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    t = {(snapshots[0]?.state?.time ?? 0).toFixed(1)}s
                  </div>
                </div>
                <CompareLegend entries={compareEntries} />
                <div className="overflow-x-auto">
                  <CompareProfileChart
                    entries={compareEntries}
                    width={Math.max(720, compareEntries.length * 60 + 600)}
                    height={340}
                  />
                </div>
              </section>

              <section className="panel p-5 space-y-3">
                <div className="label-tag">Temperature Spread (T_max − T_min)</div>
                <p className="text-xs text-muted-foreground">
                  Lower bars mean more uniform heat distribution across the pan surface.
                </p>
                <div className="overflow-x-auto">
                  <CompareDeltaBars
                    entries={compareEntries}
                    width={Math.max(480, compareEntries.length * 110 + 100)}
                    height={300}
                  />
                </div>
              </section>
            </>
          )}
        </TabsContent>

        <TabsContent value="energy" className="space-y-4">
          <Toolbar
            running={running}
            setRunning={setRunning}
            onReset={() => {
              setRunning(false);
              setResetSignal((n) => n + 1);
            }}
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
            <p className="text-xs text-muted-foreground pt-2">
              The solver is a 2D axisymmetric finite-volume scheme on a (z, r) grid. Each material
              layer is split into the chosen number of axial cells. Higher counts give a smoother
              solution but cost more CPU and lower the stable time step (changes restart the
              simulation).
            </p>
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
  running,
  setRunning,
  onReset,
  onAdd,
  ambient,
  hConv,
}: {
  running: boolean;
  setRunning: (b: boolean) => void;
  onReset: () => void;
  onAdd: () => void;
  ambient: number;
  hConv: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={() => setRunning(!running)}
        size="lg"
        variant={running ? "secondary" : "default"}
      >
        {running ? (
          <>
            <Pause className="w-4 h-4 mr-2" /> Pause
          </>
        ) : (
          <>
            <Play className="w-4 h-4 mr-2" /> Run
          </>
        )}
      </Button>
      <Button onClick={onReset} size="lg" variant="outline">
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
