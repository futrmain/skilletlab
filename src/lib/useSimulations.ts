import { useEffect, useRef, useState } from "react";
import { initSim, step, type SimState, type Layer } from "./simulation";

export interface SimInput {
  key: string;
  panRadius: number;
  rimHeight: number;
  layers: Layer[];
  heaterRadius: number; // mean radius of the heater ring
  heaterThickness: number; // radial band width of the heater ring
  heaterPower: number;
  setpointHigh: number; // K — heater off above this center top-surface temp
  setpointLow: number; // K — heater on below this center top-surface temp
  ambient: number; // K
  hConv: number;
  initialTemp: number; // K
  nr: number; // radial cells
  nzPerLayer: number; // axial cells per material layer
  dt: number; // s — Crank–Nicolson time step
  running: boolean; // per-slot run flag — only true slots get advanced
  resetTick: number; // bump to force re-init of this slot (independent of others)
}

export interface SimSnapshot {
  key: string;
  state: SimState | null;
}

// Identity that determines whether a slot needs re-init. Excludes `running`
// (toggling run/pause should NOT throw away the state) but includes
// `resetTick` (bumping it forces re-init).
function signatureOf(inp: SimInput): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { running, ...rest } = inp;
  return JSON.stringify(rest);
}

function paramsOf(inp: SimInput) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { running, resetTick, ...params } = inp;
  return params;
}

export function useSimulations(inputs: SimInput[]): SimSnapshot[] {
  const statesRef = useRef<Map<string, SimState>>(new Map());
  const sigsRef = useRef<Map<string, string>>(new Map());
  const inputsRef = useRef<SimInput[]>(inputs);
  inputsRef.current = inputs;
  const rafRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  // Per-slot init — diff against the prior signature so adding/removing one
  // slot or toggling its run flag never resets the others.
  const sigKey = inputs.map((inp) => `${inp.key}:${signatureOf(inp)}`).join("|");
  useEffect(() => {
    const states = statesRef.current;
    const sigs = sigsRef.current;
    const liveKeys = new Set(inputs.map((i) => i.key));
    for (const k of [...states.keys()]) {
      if (!liveKeys.has(k)) {
        states.delete(k);
        sigs.delete(k);
      }
    }
    for (const inp of inputs) {
      const sig = signatureOf(inp);
      if (sigs.get(inp.key) !== sig) {
        states.set(inp.key, initSim(paramsOf(inp)));
        sigs.set(inp.key, sig);
      }
    }
    setTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigKey]);

  // Per-slot RAF loop — kicks whenever something *should* be running and
  // self-stops once nothing is.
  const anyShouldRun = inputs.some((i) => i.running);
  useEffect(() => {
    if (!anyShouldRun) return;
    if (rafRef.current != null) return;
    const loop = () => {
      let anyStepped = false;
      for (const inp of inputsRef.current) {
        const st = statesRef.current.get(inp.key);
        if (!st || !inp.running || st.steady) continue;
        const target = 0.05;
        const sub = Math.max(1, Math.floor(target / st.dt));
        step(st, Math.min(sub, 5000));
        anyStepped = true;
      }
      setTick((t) => t + 1);
      if (anyStepped) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [anyShouldRun, sigKey]);

  // Cancel any pending frame on unmount.
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );

  return inputs.map((inp) => ({
    key: inp.key,
    state: statesRef.current.get(inp.key) ?? null,
  }));
}
