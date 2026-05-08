import { useEffect, useRef, useState } from "react";
import SimWorker from "./sim.worker?worker";
import { type SimState, type Layer } from "./simulation";

export interface SimInput {
  key: string;
  panRadius: number;
  rimHeight: number;
  layers: Layer[];
  heaterRadius: number;
  heaterThickness: number;
  heaterPower: number;
  setpointHigh: number;
  setpointLow: number;
  ambient: number;
  hConv: number;
  initialTemp: number;
  nr: number;
  nzPerLayer: number;
  dt: number;
  // Steak — same field set as SimParams.
  steakEnabled: boolean;
  steakRadius: number;
  steakThickness: number;
  steakDensity: number;
  steakCp: number;
  steakK: number;
  steakInitialTemp: number;
  steakEmissivity: number;
  nzSteak: number;
  steakDoneTemp: number;
  running: boolean;
  resetTick: number;
}

export interface SimSnapshot {
  key: string;
  state: SimState | null;
}

type WorkerOut = { type: "snapshots"; snapshots: { key: string; state: SimState }[] };

// Hook spawns ONE worker for all sims and forwards the user's inputs to it.
// The worker owns every SimState and steps them in the background; on each
// posted snapshot the hook bumps a tick to re-render. The UI keeps the same
// `state: SimState | null` shape it had before — the worker simply provides
// fresh snapshots instead of in-place mutation on the main thread.
export function useSimulations(inputs: SimInput[]): SimSnapshot[] {
  const workerRef = useRef<Worker | null>(null);
  const snapshotsRef = useRef<Map<string, SimState>>(new Map());
  const [, setTick] = useState(0);

  // Spawn the worker once; tear it down on unmount.
  useEffect(() => {
    const worker = new SimWorker();
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (e.data?.type !== "snapshots") return;
      const map = new Map<string, SimState>();
      for (const { key, state } of e.data.snapshots) map.set(key, state);
      snapshotsRef.current = map;
      setTick((t) => t + 1);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Forward inputs to the worker on every meaningful change. Stringify so the
  // effect only fires when at least one slot's params, run flag, or
  // resetTick differs from last post.
  const inputsKey = JSON.stringify(inputs);
  useEffect(() => {
    workerRef.current?.postMessage({ type: "config", inputs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsKey]);

  return inputs.map((inp) => ({
    key: inp.key,
    state: snapshotsRef.current.get(inp.key) ?? null,
  }));
}
