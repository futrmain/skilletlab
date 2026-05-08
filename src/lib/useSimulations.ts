import { useEffect, useRef, useState } from "react";
import { initSim, step, type SimState, type Layer } from "./simulation";

export interface SimInput {
  key: string;
  panRadius: number;
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
  steadyWindow: number; // s — sliding window for steady-state detection
}

export interface SimSnapshot {
  key: string;
  state: SimState | null;
}

export function useSimulations(
  inputs: SimInput[],
  running: boolean,
  resetSignal: number,
): SimSnapshot[] {
  const statesRef = useRef<Map<string, SimState>>(new Map());
  const [, setTick] = useState(0);

  // (re)initialize when inputs change or reset
  useEffect(() => {
    const next = new Map<string, SimState>();
    for (const inp of inputs) {
      next.set(
        inp.key,
        initSim({
          panRadius: inp.panRadius,
          layers: inp.layers,
          heaterRadius: inp.heaterRadius,
          heaterThickness: inp.heaterThickness,
          heaterPower: inp.heaterPower,
          setpointHigh: inp.setpointHigh,
          setpointLow: inp.setpointLow,
          ambient: inp.ambient,
          hConv: inp.hConv,
          nr: inp.nr,
          nzPerLayer: inp.nzPerLayer,
          dt: inp.dt,
          steadyWindow: inp.steadyWindow,
          initialTemp: inp.initialTemp,
        }),
      );
    }
    statesRef.current = next;
    setTick((t) => t + 1);
  }, [JSON.stringify(inputs), resetSignal]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      for (const st of statesRef.current.values()) {
        if (st.steady) continue; // freeze sims that have hit the steady-state criterion
        const target = 0.05;
        const sub = Math.max(1, Math.floor(target / st.dt));
        step(st, Math.min(sub, 5000));
      }
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  return inputs.map((inp) => ({
    key: inp.key,
    state: statesRef.current.get(inp.key) ?? null,
  }));
}
