
/// <reference lib="webworker" />
// Simulation worker. Owns all SimState objects and runs the time-stepping
// loop off the main thread, posting snapshots back at ~60 Hz so the UI can
// render without competing for CPU.

import { initSim, step, type SimParams, type SimState } from "./simulation";
import type { SimInput } from "./useSimulations";

declare const self: DedicatedWorkerGlobalScope;

const states = new Map<string, SimState>();
const sigs = new Map<string, string>();
let currentInputs: SimInput[] = [];
let timeoutId: ReturnType<typeof setTimeout> | null = null;

// Identity for re-init purposes — excludes `running` (so toggling pause does
// not reset the slot) but includes everything else, including `resetTick`.
function signatureOf(inp: SimInput): string {
  const { running: _running, ...rest } = inp;
  void _running;
  return JSON.stringify(rest);
}

function paramsOf(inp: SimInput): SimParams {
  const { running: _running, resetTick: _resetTick, ...params } = inp;
  void _running;
  void _resetTick;
  return params;
}

function applyConfig(newInputs: SimInput[]) {
  const liveKeys = new Set(newInputs.map((i) => i.key));
  // Evict states for slots that no longer exist.
  for (const k of [...states.keys()]) {
    if (!liveKeys.has(k)) {
      states.delete(k);
      sigs.delete(k);
    }
  }
  // Init or re-init slots whose signature changed (or is new).
  for (const inp of newInputs) {
    const sig = signatureOf(inp);
    if (sigs.get(inp.key) !== sig) {
      states.set(inp.key, initSim(paramsOf(inp)));
      sigs.set(inp.key, sig);
    }
  }
  currentInputs = newInputs;
  postSnapshots();
  scheduleTick();
}

// One scheduling tick: run as many sim substeps as we can fit in ~14 ms of
// wall-clock budget, then post a snapshot. This decouples sim throughput from
// the post rate — long-running sims still update the UI at ~60 Hz while the
// solver runs flat-out underneath.
function tick() {
  timeoutId = null;
  let anySteppedAtAll = false;
  const t0 = performance.now();
  while (performance.now() - t0 < 14) {
    let stepped = false;
    for (const inp of currentInputs) {
      const st = states.get(inp.key);
      if (!st || !inp.running || st.steady) continue;
      const target = 0.05; // sim-seconds of work per pass
      const sub = Math.max(1, Math.floor(target / st.dt));
      step(st, Math.min(sub, 5000));
      stepped = true;
    }
    if (!stepped) break;
    anySteppedAtAll = true;
  }
  if (anySteppedAtAll) postSnapshots();
  scheduleTick();
}

function scheduleTick() {
  if (timeoutId !== null) return;
  const anyShouldRun = currentInputs.some((inp) => {
    const st = states.get(inp.key);
    return !!st && inp.running && !st.steady;
  });
  if (anyShouldRun) timeoutId = setTimeout(tick, 0);
}

function postSnapshots() {
  const snapshots: { key: string; state: SimState }[] = [];
  for (const inp of currentInputs) {
    const st = states.get(inp.key);
    if (st) snapshots.push({ key: inp.key, state: st });
  }
  // Structured clone happens automatically on postMessage. Each Float64Array
  // (T2D, history, etc.) is copied; subarray views become standalone arrays
  // on the main side, which is fine because the UI only reads.
  self.postMessage({ type: "snapshots", snapshots });
}

self.onmessage = (e: MessageEvent) => {
  const data = e.data;
  if (data && data.type === "config") {
    applyConfig(data.inputs as SimInput[]);
  }
};
