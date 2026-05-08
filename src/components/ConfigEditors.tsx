import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Copy } from "lucide-react";
import { MATERIALS, type Layer } from "@/lib/simulation";
import {
  type PanConfig,
  type HeaterConfig,
  PAN_TEMPLATES,
  HEATER_TEMPLATES,
  uid,
} from "@/lib/configs";

function Field({
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
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? +value.toFixed(3) : 0}
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

export function PanEditor({
  pans,
  setPans,
}: {
  pans: PanConfig[];
  setPans: (fn: (p: PanConfig[]) => PanConfig[]) => void;
}) {
  const addBlank = () =>
    setPans((ps) => [
      ...ps,
      {
        id: uid(),
        name: "New pan",
        diameter: 0.28,
        layers: [{ name: "Aluminum", thickness: 0.003, ...MATERIALS.Aluminum }],
      },
    ]);
  const addFromTemplate = (tplId: string) => {
    const t = PAN_TEMPLATES.find((p) => p.id === tplId);
    if (!t) return;
    setPans((ps) => [
      ...ps,
      { ...t, id: uid(), name: `${t.name} (copy)`, layers: t.layers.map((l) => ({ ...l })) },
    ]);
  };
  const updatePan = (id: string, patch: Partial<PanConfig>) =>
    setPans((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const updateLayer = (id: string, idx: number, patch: Partial<Layer>) =>
    setPans((ps) =>
      ps.map((p) =>
        p.id !== id
          ? p
          : {
              ...p,
              layers: p.layers.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
            },
      ),
    );
  const setMaterial = (id: string, idx: number, name: string) => {
    const m = MATERIALS[name];
    if (!m) return;
    updateLayer(id, idx, { name, ...m });
  };
  const addLayer = (id: string) =>
    setPans((ps) =>
      ps.map((p) =>
        p.id !== id
          ? p
          : {
              ...p,
              layers: [...p.layers, { name: "Aluminum", thickness: 0.002, ...MATERIALS.Aluminum }],
            },
      ),
    );
  const removeLayer = (id: string, idx: number) =>
    setPans((ps) =>
      ps.map((p) =>
        p.id !== id
          ? p
          : {
              ...p,
              layers: p.layers.length > 1 ? p.layers.filter((_, i) => i !== idx) : p.layers,
            },
      ),
    );
  const duplicate = (id: string) =>
    setPans((ps) => {
      const p = ps.find((x) => x.id === id);
      if (!p) return ps;
      return [
        ...ps,
        { ...p, id: uid(), name: `${p.name} (copy)`, layers: p.layers.map((l) => ({ ...l })) },
      ];
    });
  const remove = (id: string) => setPans((ps) => ps.filter((p) => p.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={addBlank}>
          <Plus className="w-3 h-3 mr-1" /> New pan
        </Button>
        <Select onValueChange={addFromTemplate}>
          <SelectTrigger className="h-8 text-xs w-[260px]">
            <SelectValue placeholder="+ Add from template…" />
          </SelectTrigger>
          <SelectContent>
            {PAN_TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {pans.map((p) => {
          const totalMM = p.layers.reduce((s, l) => s + l.thickness, 0) * 1000;
          return (
            <section key={p.id} className="panel p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={p.name}
                  onChange={(e) => updatePan(p.id, { name: e.target.value })}
                  className="h-8 text-sm font-bold flex-1"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => duplicate(p.id)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => remove(p.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
              <Field
                label="Diameter (cm)"
                value={p.diameter * 100}
                step={0.5}
                min={5}
                max={50}
                onChange={(v) => updatePan(p.id, { diameter: v / 100 })}
              />
              <div className="text-xs text-muted-foreground">
                Total thickness:{" "}
                <span className="text-primary font-bold">{totalMM.toFixed(2)} mm</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="label-tag">Layers (top → bottom)</div>
                  <Button size="sm" variant="ghost" onClick={() => addLayer(p.id)}>
                    <Plus className="w-3 h-3 mr-1" /> Add
                  </Button>
                </div>
                {p.layers.map((l, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-input/40 p-2 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                      <Select value={l.name} onValueChange={(v) => setMaterial(p.id, i, v)}>
                        <SelectTrigger className="h-7 text-xs flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.keys(MATERIALS).map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => removeLayer(p.id, i)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <Field
                      label="Thickness (mm)"
                      value={l.thickness * 1000}
                      step={0.1}
                      min={0.05}
                      max={20}
                      onChange={(v) => updateLayer(p.id, i, { thickness: v / 1000 })}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        {pans.length === 0 && (
          <div className="text-sm text-muted-foreground">No pans defined. Add one above.</div>
        )}
      </div>
    </div>
  );
}

export function HeaterEditor({
  heaters,
  setHeaters,
}: {
  heaters: HeaterConfig[];
  setHeaters: (fn: (h: HeaterConfig[]) => HeaterConfig[]) => void;
}) {
  const addBlank = () =>
    setHeaters((hs) => [
      ...hs,
      {
        id: uid(),
        name: "New heater",
        diameter: 0.16,
        thickness: 0.02,
        power: 1800,
        setpointHigh: 300,
        setpointLow: 280,
      },
    ]);
  const addFromTemplate = (tplId: string) => {
    const t = HEATER_TEMPLATES.find((h) => h.id === tplId);
    if (!t) return;
    setHeaters((hs) => [...hs, { ...t, id: uid(), name: `${t.name} (copy)` }]);
  };
  const update = (id: string, patch: Partial<HeaterConfig>) =>
    setHeaters((hs) => hs.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  const duplicate = (id: string) =>
    setHeaters((hs) => {
      const h = hs.find((x) => x.id === id);
      if (!h) return hs;
      return [...hs, { ...h, id: uid(), name: `${h.name} (copy)` }];
    });
  const remove = (id: string) => setHeaters((hs) => hs.filter((h) => h.id !== id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={addBlank}>
          <Plus className="w-3 h-3 mr-1" /> New heater
        </Button>
        <Select onValueChange={addFromTemplate}>
          <SelectTrigger className="h-8 text-xs w-[260px]">
            <SelectValue placeholder="+ Add from template…" />
          </SelectTrigger>
          <SelectContent>
            {HEATER_TEMPLATES.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {heaters.map((h) => (
          <section key={h.id} className="panel p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={h.name}
                onChange={(e) => update(h.id, { name: e.target.value })}
                className="h-8 text-sm font-bold flex-1"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => duplicate(h.id)}
              >
                <Copy className="w-3 h-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(h.id)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
            <Field
              label="Ring mean diameter (cm)"
              value={h.diameter * 100}
              step={0.5}
              min={2}
              max={40}
              onChange={(v) => update(h.id, { diameter: v / 100 })}
            />
            <Field
              label="Ring thickness (cm)"
              value={h.thickness * 100}
              step={0.1}
              min={0.1}
              max={20}
              onChange={(v) => update(h.id, { thickness: v / 100 })}
            />
            <Field
              label="Power (W)"
              value={h.power}
              step={50}
              min={100}
              max={6000}
              onChange={(v) => update(h.id, { power: v })}
            />
            <Field
              label="Cut-off temp (°C)"
              value={h.setpointHigh}
              step={5}
              min={0}
              max={600}
              onChange={(v) => update(h.id, { setpointHigh: v })}
            />
            <Field
              label="Re-ignite temp (°C)"
              value={h.setpointLow}
              step={5}
              min={0}
              max={600}
              onChange={(v) => update(h.id, { setpointLow: v })}
            />
            <div className="text-xs text-muted-foreground">
              Flux:{" "}
              <span className="text-primary font-bold">
                {h.thickness > 0
                  ? (h.power / (Math.PI * h.diameter * h.thickness) / 1000).toFixed(1)
                  : "—"}{" "}
                kW/m²
              </span>
            </div>
          </section>
        ))}
        {heaters.length === 0 && (
          <div className="text-sm text-muted-foreground">No heaters defined. Add one above.</div>
        )}
      </div>
    </div>
  );
}
