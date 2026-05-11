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
  initialTempK: number;
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
  const tMinK = initialTempK;
  let tMaxK = tMinK + 1;
  for (let i = 0; i < Tarr.length; i++) if (Tarr[i] > tMaxK) tMaxK = Tarr[i];
  tMaxK = Math.max(tMaxK, tMinK + 50);

  const centerC = Tarr[0] - 273.15;
  const edgeC = Tarr[Tarr.length - 1] - 273.15;
  const peakC = tMaxK - 273.15;

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
        <span className="text-muted-foreground">
          {(pan.diameter * 100).toFixed(0)} cm · {heater.power} W
        </span>
      </div>

      <div className="flex justify-center">
        <PanView
          T={Tarr}
          r={Rarr}
          panRadius={pan.diameter / 2}
          heaterRadius={Math.min(heater.diameter / 2, pan.diameter / 2)}
          heaterThickness={heater.thickness}
          tMin={tMinK}
          tMax={tMaxK}
          size={300}
        />
      </div>

      <ProfileChart T={Tarr} r={Rarr} tMin={tMinK} tMax={tMaxK} width={320} height={140} />

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <Stat label="Center" value={`${centerC.toFixed(0)}°`} accent />
        <Stat label="Rim" value={`${edgeC.toFixed(0)}°`} />
        <Stat label="Peak" value={`${peakC.toFixed(0)}°`} />
      </div>
    </section>
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
