// 2D axisymmetric (z, r) finite-volume heat diffusion solver for layered discs.
//
// Mesh (cell-centered FV):
//   - Radial: nr equal-width cells, dr = R / nr. Cell i spans [i·dr, (i+1)·dr],
//     center at (i+0.5)·dr.
//   - Axial: each material layer is subdivided into nzPerLayer cells of equal
//     thickness dz_layer = layer.thickness / nzPerLayer. Cells are stacked from
//     bottom (j=0) to top (j=Nz-1), Nz = layers.length * nzPerLayer.
//   - Storage is row-major in axial (idx = j*Nr + i).
//
// Energy balance per cell, Crank–Nicolson via Peaceman–Rachford ADI:
//   half-step 1, implicit in r, explicit in z:
//     (ρcV/(dt/2) − L_r) T*    = ρcV/(dt/2) T_n   + L_z T_n + S
//   half-step 2, implicit in z, explicit in r:
//     (ρcV/(dt/2) − L_z) T_n+1 = ρcV/(dt/2) T*    + L_r T* + S
// Each sweep is a tridiagonal system (Thomas algorithm). Combined the scheme is
// 2nd-order in time and unconditionally stable. Radiation is linearised at T_n:
//   hRad(T_n) = ε σ (T_n² + T_amb²)(T_n + T_amb), so q″ = hRad·(T − T_amb).
// L_r = radial conduction (rim is adiabatic — no Robin term).
// L_z = axial conduction + Robin top-loss term −H_top·T (with constant +H_top·T_amb
//       moved into S).
// S   = constant sources: heater q″ on the bottom-face annular ring (gated by the
//       hysteresis state, frozen at the start of the step) and the +H_top·T_amb
//       constant from the linearised top loss.
// Boundary conditions:
//   r=0     : symmetry (face area is zero — automatic).
//   r=R     : adiabatic (no flux on rim).
//   z=0     : heater q″ on the annular ring [D/2−t/2, D/2+t/2] (clamped to pan);
//             adiabatic everywhere else on the bottom face.
//   z=H     : convective h_conv·(T−T_amb) + linearised radiative hRad(T_n)·(T−T_amb).
// Face resistance (per unit area, m²K/W):
//   - Radial face within a layer: R = dr / k_layer
//   - Axial face between cells j and j+1: R = dz_j/(2 k_j) + dz_{j+1}/(2 k_{j+1})
//
// Time step: dt is a user parameter (Solver tab). CN is unconditionally stable so
// dt is bounded only by accuracy, not stability.
//
// Energy book-keeping. The discrete scheme is exactly conservative (interior
// fluxes telescope), so for the global balance only boundary terms matter:
//   E_input(t)   = heaterPower · t                                  (cumulative J)
//   E_lossConv,  E_lossRad  = ∫₀ᵗ (top-face fluxes) dt              (cumulative J)
//   E_stored(t)  = Σ_ij ρcV_ij (T_ij(t) − T_initial)                (J)
// At end of every step() the solver pushes a HistorySample so the UI can plot
// energies and the conservation residual  E_input − E_stored − E_lossConv − E_lossRad
// (≈ floating-point round-off for this scheme) on a log-y axis.

export interface Layer {
  name: string;
  thickness: number; // m
  k: number; // W/m·K
  rho: number; // kg/m^3
  cp: number; // J/kg·K
  emissivity?: number; // 0-1, optional override (else uses MATERIALS[name].emissivity)
}

export interface SimParams {
  panRadius: number; // m
  layers: Layer[];
  heaterRadius: number; // m — mean radius of the heater ring
  heaterThickness: number; // m — radial band width of the heater ring
  heaterPower: number; // W
  setpointHigh: number; // K — heater turns OFF when center top-surface T ≥ this
  setpointLow: number; // K — heater turns ON when center top-surface T ≤ this
  ambient: number; // K
  hConv: number; // W/m²·K convective coefficient (top face)
  initialTemp: number; // K
  nr: number; // number of radial cells
  nzPerLayer: number; // axial cells per material layer (>=1)
  dt: number; // s — Crank–Nicolson time step (user-controlled, accuracy-bounded)
  steadyWindow: number; // s — sliding window for steady-state detection
}

export interface SimState {
  // Public output (kept stable for existing UI)
  T: Float64Array; // length Nr — top-surface cell-center temperatures (subarray view of T2D)
  r: Float64Array; // length Nr — radial cell-center positions (m)
  T2D: Float64Array; // length Nr * Nz — full field, idx = j*Nr + i
  z: Float64Array; // length Nz — axial cell-center positions (m, 0 = bottom face)
  Nr: number;
  Nz: number;
  time: number; // s
  dt: number; // s
  params: SimParams;

  // Mesh internals (used by step())
  dr: number;
  dz: Float64Array; // length Nz
  rLeft: Float64Array; // length Nr
  rRight: Float64Array; // length Nr
  ringArea: Float64Array; // π(rR²-rL²), length Nr — top/bottom face area
  heatedArea: Float64Array; // length Nr — bottom face area within heater ring
  k: Float64Array; // length Nz
  rho: Float64Array; // length Nz
  cp: Float64Array; // length Nz
  axialFaceR: Float64Array; // length max(0, Nz-1) — m²K/W between cells j and j+1
  H: number; // total thickness (m)
  qDensity: number; // heater W/m²
  epsTop: number; // emissivity of top surface (from topmost material layer)
  // CN diagnostics (mesh+material+dt only — known at setup)
  maxFoR: number; // max α·dt/dr² across cells
  maxFoZ: number; // max α·dt/dz² across cells
  // Steady-state detection: |⟨dE_stored/dt⟩_10s| / heaterPower < 0.01
  steady: boolean;
  steadyAtTime: number | null; // sim time at which the criterion first fired
  // ADI scratch buffers
  Tstar: Float64Array; // length Nr*Nz — intermediate field after half-step 1
  hTopBuf: Float64Array; // length Nr — H_top[i] = (h_conv + hRad(T_n))·ringArea[i]
  TnTopBuf: Float64Array; // length Nr — T_n at top row, snapshot for energy tally
  // Tridiagonal scratches (sized to max(Nr, Nz))
  tdSub: Float64Array;
  tdDiag: Float64Array;
  tdSup: Float64Array;
  tdRhs: Float64Array;
  tdSol: Float64Array;
  tdCprime: Float64Array;
  heaterOn: boolean; // hysteresis state — flipped per substep based on T_center_top

  // Energy diagnostics
  eInput: number; // J — cumulative heater input
  eLossConv: number; // J — cumulative convective top-surface loss
  eLossRad: number; // J — cumulative radiative top-surface loss
  initialTemp: number; // K — reference for E_stored = Σ ρcV (T - T_initial)
  history: HistorySample[]; // bounded; oldest decimated when full
  historyMax: number;
}

export interface HistorySample {
  t: number; // s
  eIn: number; // J — cumulative heater input
  eStored: number; // J — Σ ρcV (T − T_initial) at time t
  eConv: number; // J — cumulative convective loss
  eRad: number; // J — cumulative radiative loss
  Tcenter: number; // K — top-surface center cell temperature
  Tmax: number; // K — max top-surface temperature
  Tmin: number; // K — min top-surface temperature
  maxDeltaT: number; // K — max |T_{n+1} − T_n| over any cell in this step (peak across substeps)
}

export function effectiveProps(layers: Layer[]) {
  const H = layers.reduce((s, l) => s + l.thickness, 0);
  const rhoCH = layers.reduce((s, l) => s + l.rho * l.cp * l.thickness, 0);
  const kH = layers.reduce((s, l) => s + l.k * l.thickness, 0);
  return { H, rhoCH, kH };
}

const SIGMA = 5.670374419e-8;

export function initSim(params: SimParams): SimState {
  const { layers, panRadius, heaterRadius, heaterPower, initialTemp } = params;
  const nr = Math.max(2, Math.floor(params.nr));
  const nzPL = Math.max(1, Math.floor(params.nzPerLayer));
  const heaterT = Math.max(0, params.heaterThickness ?? 0);
  // Ring extent (clamped to pan)
  const ringIn = Math.max(0, heaterRadius - heaterT / 2);
  const ringOut = Math.min(panRadius, heaterRadius + heaterT / 2);

  // ---- Axial mesh ------------------------------------------------------
  const Nz = layers.length * nzPL;
  const dz = new Float64Array(Nz);
  const k = new Float64Array(Nz);
  const rho = new Float64Array(Nz);
  const cp = new Float64Array(Nz);
  const z = new Float64Array(Nz);
  let zCursor = 0;
  for (let l = 0; l < layers.length; l++) {
    const layer = layers[l];
    const dzl = layer.thickness / nzPL;
    for (let s = 0; s < nzPL; s++) {
      const j = l * nzPL + s;
      dz[j] = dzl;
      k[j] = layer.k;
      rho[j] = layer.rho;
      cp[j] = layer.cp;
      z[j] = zCursor + dzl * 0.5;
      zCursor += dzl;
    }
  }
  const H = zCursor;

  const axialFaceR = new Float64Array(Math.max(0, Nz - 1));
  for (let j = 0; j < Nz - 1; j++) {
    axialFaceR[j] = dz[j] / (2 * k[j]) + dz[j + 1] / (2 * k[j + 1]);
  }

  // ---- Radial mesh -----------------------------------------------------
  const dr = panRadius / nr;
  const r = new Float64Array(nr);
  const rLeft = new Float64Array(nr);
  const rRight = new Float64Array(nr);
  const ringArea = new Float64Array(nr);
  const heatedArea = new Float64Array(nr);
  let totalHeatedArea = 0;
  for (let i = 0; i < nr; i++) {
    const rl = i * dr;
    const rr = (i + 1) * dr;
    rLeft[i] = rl;
    rRight[i] = rr;
    r[i] = (rl + rr) * 0.5;
    ringArea[i] = Math.PI * (rr * rr - rl * rl);
    // Annular overlap: cell [rl, rr] ∩ ring [ringIn, ringOut]
    const a = Math.max(rl, ringIn);
    const b = Math.min(rr, ringOut);
    heatedArea[i] = b > a ? Math.PI * (b * b - a * a) : 0;
    totalHeatedArea += heatedArea[i];
  }

  // ---- Field & view ----------------------------------------------------
  const T2D = new Float64Array(nr * Nz);
  T2D.fill(initialTemp);
  const T = T2D.subarray((Nz - 1) * nr, Nz * nr); // top surface — live view

  const qDensity = totalHeatedArea > 0 ? heaterPower / totalHeatedArea : 0;
  // Top-surface emissivity from the topmost material layer
  const topLayer = layers[layers.length - 1];
  const epsTop = lookupEmissivity(topLayer);

  // CN is unconditionally stable — dt is the user-supplied accuracy step.
  const dt = Math.max(1e-6, params.dt);
  const tdMax = Math.max(nr, Nz);

  // Per-cell Fourier numbers. Pure diffusion has no advective CFL; Fo gates
  // CN accuracy and ringing tendency, not stability.
  let maxFoR = 0;
  let maxFoZ = 0;
  for (let j = 0; j < Nz; j++) {
    const alpha = k[j] / (rho[j] * cp[j]);
    const FoR = (alpha * dt) / (dr * dr);
    const FoZ = (alpha * dt) / (dz[j] * dz[j]);
    if (FoR > maxFoR) maxFoR = FoR;
    if (FoZ > maxFoZ) maxFoZ = FoZ;
  }

  return {
    T,
    r,
    T2D,
    z,
    Nr: nr,
    Nz,
    time: 0,
    dt,
    params,
    dr,
    dz,
    rLeft,
    rRight,
    ringArea,
    heatedArea,
    k,
    rho,
    cp,
    axialFaceR,
    H,
    qDensity,
    epsTop,
    maxFoR,
    maxFoZ,
    steady: false,
    steadyAtTime: null,
    Tstar: new Float64Array(nr * Nz),
    hTopBuf: new Float64Array(nr),
    TnTopBuf: new Float64Array(nr),
    tdSub: new Float64Array(tdMax),
    tdDiag: new Float64Array(tdMax),
    tdSup: new Float64Array(tdMax),
    tdRhs: new Float64Array(tdMax),
    tdSol: new Float64Array(tdMax),
    tdCprime: new Float64Array(tdMax),
    heaterOn: true,

    eInput: 0,
    eLossConv: 0,
    eLossRad: 0,
    initialTemp,
    history: [
      {
        t: 0,
        eIn: 0,
        eStored: 0,
        eConv: 0,
        eRad: 0,
        Tcenter: initialTemp,
        Tmax: initialTemp,
        Tmin: initialTemp,
        maxDeltaT: 0,
      },
    ],
    historyMax: 4000,
  };
}

function lookupEmissivity(layer: Layer): number {
  if (typeof layer.emissivity === "number") return layer.emissivity;
  return MATERIALS[layer.name]?.emissivity ?? 0.9;
}

export function step(state: SimState, substeps = 1) {
  const {
    T2D,
    dt,
    params,
    Nr,
    Nz,
    dr,
    dz,
    rLeft,
    rRight,
    ringArea,
    heatedArea,
    k,
    rho,
    cp,
    axialFaceR,
    qDensity,
    epsTop,
    Tstar,
    hTopBuf,
    TnTopBuf,
    tdSub,
    tdDiag,
    tdSup,
    tdRhs,
    tdSol,
    tdCprime,
  } = state;
  const Tamb = params.ambient;
  const hConv = params.hConv;
  const heaterPower = params.heaterPower;
  const setHigh = Math.max(params.setpointHigh, params.setpointLow);
  const setLow = Math.min(params.setpointHigh, params.setpointLow);
  const TWO_PI = 2 * Math.PI;
  const topRowOff = (Nz - 1) * Nr;
  const halfDt = dt * 0.5;

  let eInput = state.eInput;
  let eLossConv = state.eLossConv;
  let eLossRad = state.eLossRad;
  let heaterOn = state.heaterOn;
  let maxDeltaT = 0; // peak |T_{n+1} − T_n| across all substeps + cells in this call

  for (let s = 0; s < substeps; s++) {
    // Hysteresis decision frozen for the whole step (T at its start).
    const Tcenter = T2D[topRowOff];
    if (heaterOn && Tcenter >= setHigh) heaterOn = false;
    else if (!heaterOn && Tcenter <= setLow) heaterOn = true;
    const heaterFactor = heaterOn ? 1 : 0;

    // Linearise top-face radiation at T_n and snapshot T_n at the top row.
    for (let i = 0; i < Nr; i++) {
      const Tn = T2D[topRowOff + i];
      const hRad = epsTop * SIGMA * (Tn * Tn + Tamb * Tamb) * (Tn + Tamb);
      hTopBuf[i] = (hConv + hRad) * ringArea[i]; // W/K
      TnTopBuf[i] = Tn;
    }

    // ---- Half-step 1: implicit in r, explicit in z (one tridiag per row j) ----
    for (let j = 0; j < Nz; j++) {
      const kj = k[j];
      const dzj = dz[j];
      const rcDzj = rho[j] * cp[j] * dzj;
      const rowOff = j * Nr;
      const RbotR = j > 0 ? axialFaceR[j - 1] : 0;
      const RtopR = j < Nz - 1 ? axialFaceR[j] : 0;
      const isTop = j === Nz - 1;
      const isBot = j === 0;

      for (let i = 0; i < Nr; i++) {
        const idx = rowOff + i;
        const A = ringArea[i];
        const rhocV_dt2 = (rcDzj * A) / halfDt;
        const Gin = i > 0 ? (kj * TWO_PI * rLeft[i] * dzj) / dr : 0;
        const Gout = i < Nr - 1 ? (kj * TWO_PI * rRight[i] * dzj) / dr : 0;

        tdSub[i] = -Gin;
        tdSup[i] = -Gout;
        tdDiag[i] = rhocV_dt2 + Gin + Gout;

        // RHS = ρcV/(dt/2)·T_n + (L_z T_n) + S
        let rhs = rhocV_dt2 * T2D[idx];
        if (j > 0) {
          const Gbot = A / RbotR;
          rhs += Gbot * (T2D[idx - Nr] - T2D[idx]);
        }
        if (j < Nz - 1) {
          const Gtop = A / RtopR;
          rhs += Gtop * (T2D[idx + Nr] - T2D[idx]);
        }
        if (isTop) {
          // Robin: −H·T (linear) + H·T_amb (source)
          rhs -= hTopBuf[i] * T2D[idx];
          rhs += hTopBuf[i] * Tamb;
        }
        if (isBot && heaterOn && heatedArea[i] > 0) {
          rhs += qDensity * heatedArea[i];
        }
        tdRhs[i] = rhs;
      }
      solveTridiag(tdSub, tdDiag, tdSup, tdRhs, tdSol, tdCprime, Nr);
      for (let i = 0; i < Nr; i++) {
        Tstar[rowOff + i] = tdSol[i];
      }
    }

    // ---- Half-step 2: implicit in z, explicit in r (one tridiag per column i) ----
    for (let i = 0; i < Nr; i++) {
      const A = ringArea[i];
      for (let j = 0; j < Nz; j++) {
        const idx = j * Nr + i;
        const dzj = dz[j];
        const kj = k[j];
        const rcDzj = rho[j] * cp[j] * dzj;
        const rhocV_dt2 = (rcDzj * A) / halfDt;
        const Gbot = j > 0 ? A / axialFaceR[j - 1] : 0;
        const Gtop = j < Nz - 1 ? A / axialFaceR[j] : 0;
        const isTop = j === Nz - 1;
        const isBot = j === 0;

        tdSub[j] = -Gbot;
        tdSup[j] = -Gtop;
        let diag = rhocV_dt2 + Gbot + Gtop;
        if (isTop) diag += hTopBuf[i];
        tdDiag[j] = diag;

        // RHS = ρcV/(dt/2)·T* + (L_r T*) + S
        let rhs = rhocV_dt2 * Tstar[idx];
        if (i > 0) {
          const Gin = (kj * TWO_PI * rLeft[i] * dzj) / dr;
          rhs += Gin * (Tstar[idx - 1] - Tstar[idx]);
        }
        if (i < Nr - 1) {
          const Gout = (kj * TWO_PI * rRight[i] * dzj) / dr;
          rhs += Gout * (Tstar[idx + 1] - Tstar[idx]);
        }
        if (isTop) rhs += hTopBuf[i] * Tamb;
        if (isBot && heaterOn && heatedArea[i] > 0) rhs += qDensity * heatedArea[i];

        tdRhs[j] = rhs;
      }
      solveTridiag(tdSub, tdDiag, tdSup, tdRhs, tdSol, tdCprime, Nz);
      // T2D still holds T_n for this column — capture |T_{n+1} − T_n| then overwrite
      for (let j = 0; j < Nz; j++) {
        const idx = j * Nr + i;
        const diff = tdSol[j] - T2D[idx];
        const ad = diff < 0 ? -diff : diff;
        if (ad > maxDeltaT) maxDeltaT = ad;
        T2D[idx] = tdSol[j];
      }
    }

    // ---- Energy tally (trapezoidal on top surface, exact for the applied flux) ----
    // PR-ADI applies top-loss flux as ½(loss(T_n) + loss(T_{n+1})) over the step,
    // with hRad frozen at T_n inside hTopBuf[i] = (h_conv + hRad)·A.
    for (let i = 0; i < Nr; i++) {
      const Tn = TnTopBuf[i];
      const Tnp1 = T2D[topRowOff + i];
      const Tavg = 0.5 * (Tn + Tnp1);
      const dTavg = Tavg - Tamb;
      const A = ringArea[i];
      const hRad = (hTopBuf[i] - hConv * A) / A; // recover hRad from H_top = (h_conv+hRad)·A
      eLossConv += hConv * dTavg * A * dt;
      eLossRad += hRad * dTavg * A * dt;
    }

    state.time += dt;
    eInput += heaterFactor * heaterPower * dt;
  }

  state.eInput = eInput;
  state.eLossConv = eLossConv;
  state.eLossRad = eLossRad;
  state.heaterOn = heaterOn;

  // E_stored = Σ_ij ρcV_ij · (T_ij - T_initial) at the new time
  let eStored = 0;
  const T0 = state.initialTemp;
  for (let j = 0; j < Nz; j++) {
    const rcDz = rho[j] * cp[j] * dz[j];
    const rowOff = j * Nr;
    let rowSum = 0;
    for (let i = 0; i < Nr; i++) {
      rowSum += ringArea[i] * (T2D[rowOff + i] - T0);
    }
    eStored += rcDz * rowSum;
  }

  // Top-surface temperature stats at the new time
  let Tmax = -Infinity;
  let Tmin = Infinity;
  for (let i = 0; i < Nr; i++) {
    const Ti = T2D[topRowOff + i];
    if (Ti > Tmax) Tmax = Ti;
    if (Ti < Tmin) Tmin = Ti;
  }
  const Tcenter = T2D[topRowOff];

  pushHistory(state, {
    t: state.time,
    eIn: eInput,
    eStored,
    eConv: eLossConv,
    eRad: eLossRad,
    Tcenter,
    Tmax,
    Tmin,
    maxDeltaT,
  });

  // Steady-state detection — both criteria must hold over a sliding window of
  // length W = params.steadyWindow:
  //   (1) energy:  |⟨dE_stored/dt⟩_W| / heaterPower < 1%
  //   (2) spatial: |ΔT_min| / max(T_max − T_amb, 1)  < 1%
  // The energy check alone false-positives for low-α materials (e.g. carbon
  // steel) once the heater is cycling but the rim is still slowly warming up:
  // cycle-averaged dE/dt is small while the spatial gradient is far from
  // settled. T_min is the slowest-evolving point (rim, adiabatic, longest
  // diffusion path), so requiring its drift to be small relative to the
  // overall ΔT scale catches that transient. The startup case (T_min still =
  // T_amb, ΔT_min = 0) is naturally excluded because the energy criterion
  // fails while the heater is dumping full power into the pan.
  if (!state.steady) {
    const heaterP = params.heaterPower;
    const W = Math.max(1, params.steadyWindow);
    if (heaterP > 0 && state.time >= W) {
      const targetT = state.time - W;
      const h = state.history;
      let i = h.length - 1;
      while (i > 0 && h[i].t > targetT) i--;
      const old = h[i];
      const dT = state.time - old.t;
      if (dT >= W) {
        const avgRate = (eStored - old.eStored) / dT; // W
        const energyNorm = Math.abs(avgRate) / heaterP;
        const Tspan = Math.max(Tmax - Tamb, 1);
        const spatialNorm = Math.abs(Tmin - old.Tmin) / Tspan;
        if (energyNorm < 0.01 && spatialNorm < 0.01) {
          state.steady = true;
          state.steadyAtTime = state.time;
        }
      }
    }
  }
}

// Thomas algorithm for tridiagonal A·x = d.
//   sub[1..n-1]   sub-diagonal       (sub[0] unused)
//   diag[0..n-1]  main diagonal
//   sup[0..n-2]   super-diagonal     (sup[n-1] unused)
//   rhs[0..n-1]   right-hand side
//   sol[0..n-1]   output
//   cprime[0..n-1] scratch (size n)
function solveTridiag(
  sub: Float64Array,
  diag: Float64Array,
  sup: Float64Array,
  rhs: Float64Array,
  sol: Float64Array,
  cprime: Float64Array,
  n: number,
) {
  let beta = diag[0];
  cprime[0] = sup[0] / beta;
  sol[0] = rhs[0] / beta;
  for (let i = 1; i < n; i++) {
    beta = diag[i] - sub[i] * cprime[i - 1];
    cprime[i] = i < n - 1 ? sup[i] / beta : 0;
    sol[i] = (rhs[i] - sub[i] * sol[i - 1]) / beta;
  }
  for (let i = n - 2; i >= 0; i--) {
    sol[i] -= cprime[i] * sol[i + 1];
  }
}

function pushHistory(state: SimState, sample: HistorySample) {
  const h = state.history;
  h.push(sample);
  if (h.length > state.historyMax) {
    // 2:1 decimation — keep every other sample (preserve the latest)
    const out: HistorySample[] = [];
    for (let i = h.length % 2; i < h.length; i += 2) out.push(h[i]);
    state.history = out;
  }
}

export interface Material {
  k: number; // W/m·K
  rho: number; // kg/m³
  cp: number; // J/kg·K
  emissivity: number; // 0-1, surface emissivity (for top-face radiation)
}

export const MATERIALS: Record<string, Material> = {
  Aluminum: { k: 237, rho: 2700, cp: 900, emissivity: 0.1 },
  "Cast Iron": { k: 80, rho: 7200, cp: 460, emissivity: 0.85 },
  "Carbon Steel": { k: 50, rho: 7850, cp: 490, emissivity: 0.8 },
  "Stainless 304": { k: 16, rho: 8000, cp: 500, emissivity: 0.25 },
  Copper: { k: 400, rho: 8960, cp: 385, emissivity: 0.05 },
  Titanium: { k: 22, rho: 4500, cp: 520, emissivity: 0.2 },
  Ceramic: { k: 2, rho: 2300, cp: 800, emissivity: 0.9 },
};
