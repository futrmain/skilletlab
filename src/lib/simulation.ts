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
//
// Stopping criteria — two-phase when the steak is enabled, single-phase otherwise.
// Phase A (always): the heater hysteresis defines a natural limit cycle. We
//   time-integrate T_edge (the top-surface cell at the cooking-zone outer edge,
//   i = nInner − 1) over each cycle; once two complete cycles are in hand, we
//   compare avg(T_edge)_last vs avg(T_edge)_prev. When the relative change is
//   ≤ 2 % the pan has reached steady state.
// Phase B (steak enabled): once Phase A fires, the steak is dropped onto the
//   pan and the simulation continues. The final stopping criterion becomes
//   "the steak is cooked throughout" — i.e. the coldest cell anywhere in the
//   steak reaches the user's done temperature (default ≈ 55 °C, medium-rare).
//   That latches state.steady = true.
// When the steak is disabled the Phase A latch is the final one (state.steady
// fires immediately on the first cycle convergence).

export interface Layer {
  name: string;
  thickness: number; // m
  k: number; // W/m·K
  rho: number; // kg/m^3
  cp: number; // J/kg·K
  emissivity?: number; // 0-1, optional override (else uses MATERIALS[name].emissivity)
}

export interface SimParams {
  panRadius: number; // m — cooking-surface radius (heater stays inside this)
  rimHeight: number; // m — radial rim past the cooking edge (flat flange exposed to air on both sides)
  layers: Layer[];
  heaterRadius: number; // m — mean radius of the heater ring
  heaterThickness: number; // m — radial band width of the heater ring
  heaterPower: number; // W
  setpointHigh: number; // K — heater turns OFF when center top-surface T ≥ this
  setpointLow: number; // K — heater turns ON when center top-surface T ≤ this
  ambient: number; // K
  hConv: number; // W/m²·K convective coefficient (top face + rim bottom)
  initialTemp: number; // K
  nr: number; // number of radial cells (target total — split between cooking zone and rim)
  nzPerLayer: number; // axial cells per material layer (>=1)
  dt: number; // s — Crank–Nicolson time step (user-controlled, accuracy-bounded)
  // Steak (cooked food) — added at the centre of the pan once the pan reaches
  // its first steady state. The steak is an axisymmetric cylinder placed on
  // top of the cooking surface (z = H), r ∈ [0, steakRadius].
  steakEnabled: boolean;
  steakRadius: number; // m
  steakThickness: number; // m
  steakDensity: number; // kg/m³ — typical raw beef ≈ 1050
  steakCp: number; // J/(kg·K) — typical raw beef ≈ 3500
  steakK: number; // W/(m·K) — typical raw beef ≈ 0.48
  steakInitialTemp: number; // K — fridge-cold default ≈ 5 °C → 278.15 K
  steakEmissivity: number; // 0–1 — wet beef ≈ 0.95
  nzSteak: number; // axial cells in the steak (≥1)
  steakDoneTemp: number; // K — final stopping temperature for the steak's coldest cell (≈ 55 °C medium-rare)
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
  drFace: Float64Array; // length Nr — distance between centers of cell i-1 and cell i (drFace[0] unused)
  dz: Float64Array; // length Nz
  rLeft: Float64Array; // length Nr
  rRight: Float64Array; // length Nr
  ringArea: Float64Array; // π(rR²-rL²), length Nr — top/bottom face area
  heatedArea: Float64Array; // length Nr — bottom face area within heater ring
  nInner: number; // number of cells inside the cooking zone (rRight[nInner-1] = panRadius exactly)
  isExt: Uint8Array; // length Nr — 1 if cell i is in the rim zone (bottom face = air), 0 otherwise
  k: Float64Array; // length Nz
  rho: Float64Array; // length Nz
  cp: Float64Array; // length Nz
  axialFaceR: Float64Array; // length max(0, Nz-1) — m²K/W between cells j and j+1
  H: number; // total thickness (m)
  qDensity: number; // heater W/m²
  epsTop: number; // emissivity of top surface (from topmost material layer)
  epsBot: number; // emissivity of bottom surface (from bottommost material layer)
  // CN diagnostics (mesh+material+dt only — known at setup)
  maxFoR: number; // max α·dt/dr² across cells
  maxFoZ: number; // max α·dt/dz² across cells
  // Steady-state detection — cycle-based:
  //   Average T_edge over each heater on/off cycle (rising edge → rising edge).
  //   Steady when |avg(T_edge)_last − avg(T_edge)_prev| / avg(T_edge)_prev ≤ 2%.
  steady: boolean;
  steadyAtTime: number | null; // sim time at which the criterion first fired
  cycleStartTime: number; // sim time at which the current cycle began
  cycleTedgeIntegral: number; // ∫T_edge dt accumulated over the current cycle (K·s)
  lastCycleAvgTedge: number | null; // avg T_edge over the most recently completed cycle (K)
  prevCycleAvgTedge: number | null; // avg T_edge over the cycle before that (K)
  // "Cooking ready" — sim time at which T_edge on the top surface first reaches
  // the Maillard threshold (the cooking-edge cell is hot enough to brown food).
  cookingReadyAtTime: number | null;

  // Steak ("cooked food") — placed on the pan at the centre once the pan
  // first reaches steady state. Once active, the pan and steak are coupled
  // explicitly through a contact face at z = H for cells under the steak.
  steakActive: boolean; // true after the steak has been dropped
  steakDroppedAt: number | null; // sim time when the steak was dropped (= first steady)
  steakNr: number; // radial cells in the steak (= number of pan cells with rRight ≤ steakRadius)
  steakNz: number; // axial cells in the steak
  Tsteak: Float64Array; // length steakNr * steakNz, idx = k*steakNr + i (k axial, i radial)
  TsteakStar: Float64Array; // ADI scratch
  drSteak: number; // m — radial cell width (matches the pan's cooking-zone-A width)
  dzSteak: number; // m — axial cell width
  ringAreaSteak: Float64Array; // length steakNr — top/bottom face area per radial cell (= pan's ringArea[0..steakNr-1])
  rSteakLeft: Float64Array; // length steakNr
  rSteakRight: Float64Array; // length steakNr
  kSteak: number;
  rhoSteak: number;
  cpSteakK: number; // (renamed to avoid clash with the pan `cp` Float64Array)
  epsSteak: number;
  steakInitialTempK: number; // reference for E_stored_steak
  // Pan ↔ steak interface conductance per pan-top cell (W/K). Only non-zero
  // for i < steakNr; computed as harmonic mean of half-cell pan conductivity
  // and half-cell steak conductivity, scaled by ringArea.
  gContactPerCell: Float64Array; // length Nr (zero outside the steak)
  // Steak air-loss scratch (one buffer per face direction).
  hSteakTopBuf: Float64Array; // length steakNr — top face Robin coefficient W/K (k = nzSteak-1)
  TnSteakTopBuf: Float64Array; // T_n at steak top row
  hSteakSideBuf: Float64Array; // length steakNz — outer-side face Robin (i = steakNr-1)
  TnSteakSideBuf: Float64Array; // T_n at steak outer-side column
  // ADI scratch buffers
  Tstar: Float64Array; // length Nr*Nz — intermediate field after half-step 1
  hTopBuf: Float64Array; // length Nr — H_top[i] = (h_conv + hRad(T_n))·ringArea[i]
  TnTopBuf: Float64Array; // length Nr — T_n at top row, snapshot for energy tally
  hBotBuf: Float64Array; // length Nr — H_bot[i] for rim cells (0 in cooking zone)
  TnBotBuf: Float64Array; // length Nr — T_n at bottom row, snapshot for energy tally
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
  historyIntervalSec: number; // sim-time interval between history pushes (UI sampling rate)
  lastHistoryTime: number; // sim time of the most recent push
}

export interface HistorySample {
  t: number; // s
  eIn: number; // J — cumulative heater input
  eStored: number; // J — Σ ρcV (T − T_initial) at time t
  eConv: number; // J — cumulative convective loss
  eRad: number; // J — cumulative radiative loss
  Tcenter: number; // K — top-surface center cell temperature
  Tmax: number; // K — max top-surface temperature
  Tedge: number; // K — top-surface cell at the cooking-zone outer edge (i = nInner − 1)
  maxDeltaT: number; // K — max |T_{n+1} − T_n| over any cell in this step (peak across substeps)
}

export function effectiveProps(layers: Layer[]) {
  const H = layers.reduce((s, l) => s + l.thickness, 0);
  const rhoCH = layers.reduce((s, l) => s + l.rho * l.cp * l.thickness, 0);
  const kH = layers.reduce((s, l) => s + l.k * l.thickness, 0);
  return { H, rhoCH, kH };
}

const SIGMA = 5.670374419e-8;
// Reference temperatures shown on the temperature-history chart and used for
// the "cooking ready" latch. Keep these in sync with TempHistoryChart's
// defaults: the cooking-ready latch fires when T_edge crosses Maillard, and
// the chart still displays a Sear reference line at 200 °C.
export const MAILLARD_TEMP_K = 150 + 273.15;
export const SEARING_TEMP_K = 200 + 273.15;

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
  // Up to three regions split by THREE candidate boundaries:
  //   A: [0, steakRadius]              — cells under the (optional) steak
  //   B: [steakRadius, panRadius]      — cooking zone outside the steak
  //   C: [panRadius, panRadius+rim]    — rim flange (air below)
  // Cell edges land EXACTLY at every internal boundary so coupling at
  // steakRadius and panRadius is clean (no fractional overlap).
  const rimHeight = Math.max(0, params.rimHeight ?? 0);
  const steakEnabledParam = !!params.steakEnabled;
  const steakRadius =
    steakEnabledParam && params.steakRadius > 0 ? Math.min(panRadius, params.steakRadius) : 0;
  const totalR = panRadius + rimHeight;
  // Aim for ~uniform Δr across regions.
  const drTarget = totalR > 0 ? totalR / nr : 0;
  const nA = steakRadius > 0 ? Math.max(1, Math.round(steakRadius / Math.max(drTarget, 1e-12))) : 0;
  const drA = nA > 0 ? steakRadius / nA : 0;
  const nB =
    panRadius - steakRadius > 0
      ? Math.max(1, Math.round((panRadius - steakRadius) / Math.max(drTarget, 1e-12)))
      : 0;
  const drB = nB > 0 ? (panRadius - steakRadius) / nB : 0;
  const nC = rimHeight > 0 ? Math.max(1, Math.round(rimHeight / Math.max(drTarget, 1e-12))) : 0;
  const drC = nC > 0 ? rimHeight / nC : 0;
  const nInner = nA + nB;
  const Nr = nA + nB + nC;
  const r = new Float64Array(Nr);
  const rLeft = new Float64Array(Nr);
  const rRight = new Float64Array(Nr);
  const ringArea = new Float64Array(Nr);
  const heatedArea = new Float64Array(Nr);
  const isExt = new Uint8Array(Nr);
  let totalHeatedArea = 0;
  for (let i = 0; i < Nr; i++) {
    let rl: number;
    let rr: number;
    if (i < nA) {
      rl = i * drA;
      rr = (i + 1) * drA;
    } else if (i < nA + nB) {
      const j = i - nA;
      rl = steakRadius + j * drB;
      rr = steakRadius + (j + 1) * drB;
    } else {
      const j = i - nA - nB;
      rl = panRadius + j * drC;
      rr = panRadius + (j + 1) * drC;
      isExt[i] = 1;
    }
    rLeft[i] = rl;
    rRight[i] = rr;
    r[i] = (rl + rr) * 0.5;
    ringArea[i] = Math.PI * (rr * rr - rl * rl);
    if (i < nInner) {
      const a = Math.max(rl, ringIn);
      const b = Math.min(rr, ringOut);
      heatedArea[i] = b > a ? Math.PI * (b * b - a * a) : 0;
    } else {
      heatedArea[i] = 0;
    }
    totalHeatedArea += heatedArea[i];
  }
  // Snap edges to exact boundaries (avoid FP drift).
  if (nA > 0) rRight[nA - 1] = steakRadius;
  if (nB > 0) rLeft[nA] = steakRadius;
  if (nInner > 0) rRight[nInner - 1] = panRadius;
  if (nC > 0) rLeft[nInner] = panRadius;
  const drFace = new Float64Array(Nr);
  for (let i = 1; i < Nr; i++) drFace[i] = r[i] - r[i - 1];
  const drMin = Math.min(
    drA > 0 ? drA : Infinity,
    drB > 0 ? drB : Infinity,
    drC > 0 ? drC : Infinity,
  );

  // ---- Field & view ----------------------------------------------------
  const T2D = new Float64Array(Nr * Nz);
  T2D.fill(initialTemp);
  const T = T2D.subarray((Nz - 1) * Nr, Nz * Nr); // top surface — live view

  const qDensity = totalHeatedArea > 0 ? heaterPower / totalHeatedArea : 0;
  // Top + bottom surface emissivities from outermost material layers.
  const topLayer = layers[layers.length - 1];
  const botLayer = layers[0];
  const epsTop = lookupEmissivity(topLayer);
  const epsBot = lookupEmissivity(botLayer);

  // CN is unconditionally stable — dt is the user-supplied accuracy step.
  const dt = Math.max(1e-6, params.dt);

  // ---- Steak mesh (lazy: still allocated when steakEnabled, even though the
  //      steak is dropped only after the pan reaches its first steady state.
  //      A mesh allocated now is cheap and avoids an awkward re-init mid-run).
  const steakNr = nA;
  const steakNz = Math.max(1, Math.floor(params.nzSteak ?? 1));
  const steakThickness = Math.max(0, params.steakThickness ?? 0);
  const dzSteak = steakNz > 0 ? steakThickness / steakNz : 0;
  const Tsteak = new Float64Array(steakNr * steakNz);
  Tsteak.fill(params.steakInitialTemp);
  const TsteakStar = new Float64Array(steakNr * steakNz);
  const ringAreaSteak = new Float64Array(steakNr);
  const rSteakLeft = new Float64Array(steakNr);
  const rSteakRight = new Float64Array(steakNr);
  for (let i = 0; i < steakNr; i++) {
    rSteakLeft[i] = rLeft[i];
    rSteakRight[i] = rRight[i];
    ringAreaSteak[i] = ringArea[i];
  }
  // Contact conductance per cell (W/K): harmonic mean of half-cell pan
  // conductivity (top axial layer) and half-cell steak conductivity, scaled
  // by the cell's ring area at the contact face (z = H).
  const gContactPerCell = new Float64Array(Nr);
  if (steakEnabledParam && steakNr > 0 && Nz > 0 && steakNz > 0) {
    const kPanTop = k[Nz - 1];
    const kSteakLocal = Math.max(1e-6, params.steakK ?? 0.48);
    const Rface = dz[Nz - 1] / (2 * kPanTop) + dzSteak / (2 * kSteakLocal); // m²K/W per unit area
    for (let i = 0; i < steakNr; i++) {
      gContactPerCell[i] = ringAreaSteak[i] / Rface;
    }
  }
  const tdMax = Math.max(Nr, Nz, steakNz);

  // Per-cell Fourier numbers. Pure diffusion has no advective CFL; Fo gates
  // CN accuracy and ringing tendency, not stability. Use min Δr (across the
  // cooking-zone and rim cell sizes) so the diagnostic stays meaningful.
  let maxFoR = 0;
  let maxFoZ = 0;
  for (let j = 0; j < Nz; j++) {
    const alpha = k[j] / (rho[j] * cp[j]);
    const FoR = (alpha * dt) / (drMin * drMin);
    const FoZ = (alpha * dt) / (dz[j] * dz[j]);
    if (FoR > maxFoR) maxFoR = FoR;
    if (FoZ > maxFoZ) maxFoZ = FoZ;
  }

  return {
    T,
    r,
    T2D,
    z,
    Nr,
    Nz,
    time: 0,
    dt,
    params,
    drFace,
    dz,
    rLeft,
    rRight,
    ringArea,
    heatedArea,
    nInner,
    isExt,
    k,
    rho,
    cp,
    axialFaceR,
    H,
    qDensity,
    epsTop,
    epsBot,
    maxFoR,
    maxFoZ,
    steady: false,
    steadyAtTime: null,
    cycleStartTime: 0,
    cycleTedgeIntegral: 0,
    lastCycleAvgTedge: null,
    prevCycleAvgTedge: null,
    cookingReadyAtTime: null,
    steakActive: false,
    steakDroppedAt: null,
    steakNr,
    steakNz,
    Tsteak,
    TsteakStar,
    drSteak: drA,
    dzSteak,
    ringAreaSteak,
    rSteakLeft,
    rSteakRight,
    kSteak: Math.max(1e-6, params.steakK ?? 0.48),
    rhoSteak: Math.max(1e-6, params.steakDensity ?? 1050),
    cpSteakK: Math.max(1e-6, params.steakCp ?? 3500),
    epsSteak: params.steakEmissivity ?? 0.95,
    steakInitialTempK: params.steakInitialTemp,
    gContactPerCell,
    hSteakTopBuf: new Float64Array(steakNr),
    TnSteakTopBuf: new Float64Array(steakNr),
    hSteakSideBuf: new Float64Array(steakNz),
    TnSteakSideBuf: new Float64Array(steakNz),
    Tstar: new Float64Array(Nr * Nz),
    hTopBuf: new Float64Array(Nr),
    TnTopBuf: new Float64Array(Nr),
    hBotBuf: new Float64Array(Nr),
    TnBotBuf: new Float64Array(Nr),
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
        Tedge: initialTemp,
        maxDeltaT: 0,
      },
    ],
    historyMax: 4000,
    historyIntervalSec: 2.0,
    lastHistoryTime: 0,
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
    drFace,
    dz,
    rLeft,
    rRight,
    ringArea,
    heatedArea,
    nInner,
    isExt,
    k,
    rho,
    cp,
    axialFaceR,
    qDensity,
    epsTop,
    epsBot,
    Tstar,
    hTopBuf,
    TnTopBuf,
    hBotBuf,
    TnBotBuf,
    tdSub,
    tdDiag,
    tdSup,
    tdRhs,
    tdSol,
    tdCprime,
    Tsteak,
    TsteakStar,
    steakNr,
    steakNz,
    drSteak,
    dzSteak,
    ringAreaSteak,
    rSteakLeft,
    rSteakRight,
    kSteak,
    rhoSteak,
    cpSteakK,
    epsSteak,
    gContactPerCell,
    hSteakTopBuf,
    TnSteakTopBuf,
    hSteakSideBuf,
    TnSteakSideBuf,
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
    const prevHeaterOn = heaterOn;
    if (heaterOn && Tcenter >= setHigh) heaterOn = false;
    else if (!heaterOn && Tcenter <= setLow) heaterOn = true;
    const heaterFactor = heaterOn ? 1 : 0;

    // Rising edge (off → on) closes the previous cycle and opens a new one.
    if (!prevHeaterOn && heaterOn) {
      const cycleDuration = state.time - state.cycleStartTime;
      if (cycleDuration > 0) {
        const avgTedge = state.cycleTedgeIntegral / cycleDuration;
        state.prevCycleAvgTedge = state.lastCycleAvgTedge;
        state.lastCycleAvgTedge = avgTedge;
        if (!state.steady && state.prevCycleAvgTedge !== null && state.prevCycleAvgTedge > 0) {
          const relChange = Math.abs(avgTedge - state.prevCycleAvgTedge) / state.prevCycleAvgTedge;
          if (relChange <= 0.02) {
            if (params.steakEnabled && !state.steakActive && steakNr > 0 && steakNz > 0) {
              // Phase A → Phase B: drop the steak and keep simulating. The
              // final stopping criterion is now "cooked throughout", checked
              // after each substep below.
              Tsteak.fill(params.steakInitialTemp);
              state.steakActive = true;
              state.steakDroppedAt = state.time;
              state.lastCycleAvgTedge = null;
              state.prevCycleAvgTedge = null;
            } else if (!params.steakEnabled) {
              // No steak phase — the pan's limit cycle is the final criterion.
              state.steady = true;
              state.steadyAtTime = state.time;
            }
            // else: steak active. Cycle criterion is no longer the stopping
            // condition; "steak cooked through" is. Just let the loop keep
            // running.
          }
        }
      }
      state.cycleStartTime = state.time;
      state.cycleTedgeIntegral = 0;
    }

    // Linearise top-face radiation at T_n and snapshot T_n at the top row.
    for (let i = 0; i < Nr; i++) {
      const Tn = T2D[topRowOff + i];
      const hRad = epsTop * SIGMA * (Tn * Tn + Tamb * Tamb) * (Tn + Tamb);
      hTopBuf[i] = (hConv + hRad) * ringArea[i]; // W/K
      TnTopBuf[i] = Tn;
    }
    // Same treatment for the bottom face of rim cells (j=0). H = 0 for
    // cooking-zone cells where the bottom is heater + adiabatic.
    for (let i = 0; i < Nr; i++) {
      const Tn = T2D[i]; // j=0 row
      TnBotBuf[i] = Tn;
      if (isExt[i]) {
        const hRad = epsBot * SIGMA * (Tn * Tn + Tamb * Tamb) * (Tn + Tamb);
        hBotBuf[i] = (hConv + hRad) * ringArea[i];
      } else {
        hBotBuf[i] = 0;
      }
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
        const Gin = i > 0 ? (kj * TWO_PI * rLeft[i] * dzj) / drFace[i] : 0;
        const Gout = i < Nr - 1 ? (kj * TWO_PI * rRight[i] * dzj) / drFace[i + 1] : 0;

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
          if (state.steakActive && i < steakNr && gContactPerCell[i] > 0) {
            // Contact with steak: replace air Robin with a constant source
            // computed from the snapshotted T_n on both sides (explicit
            // coupling — same source applied in BOTH half-steps so the total
            // flux over a full step is dt · Q_contact_n).
            const Qc = gContactPerCell[i] * (TnTopBuf[i] - Tsteak[i]);
            rhs -= Qc;
          } else {
            // Air Robin: −H·T (linear) + H·T_amb (source)
            rhs -= hTopBuf[i] * T2D[idx];
            rhs += hTopBuf[i] * Tamb;
          }
        }
        if (isBot) {
          if (heaterOn && heatedArea[i] > 0) {
            rhs += qDensity * heatedArea[i];
          }
          // Bottom-face air loss in the rim zone (cooking-zone bottom is
          // either heater or adiabatic, hBotBuf is 0 there).
          if (hBotBuf[i] > 0) {
            rhs -= hBotBuf[i] * T2D[idx];
            rhs += hBotBuf[i] * Tamb;
          }
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

        const useContact = state.steakActive && i < steakNr && gContactPerCell[i] > 0;
        tdSub[j] = -Gbot;
        tdSup[j] = -Gtop;
        let diag = rhocV_dt2 + Gbot + Gtop;
        if (isTop && !useContact) diag += hTopBuf[i];
        // Bottom Robin (rim cells only): on the diagonal in the implicit-z half.
        if (isBot && hBotBuf[i] > 0) diag += hBotBuf[i];
        tdDiag[j] = diag;

        // RHS = ρcV/(dt/2)·T* + (L_r T*) + S
        let rhs = rhocV_dt2 * Tstar[idx];
        if (i > 0) {
          const Gin = (kj * TWO_PI * rLeft[i] * dzj) / drFace[i];
          rhs += Gin * (Tstar[idx - 1] - Tstar[idx]);
        }
        if (i < Nr - 1) {
          const Gout = (kj * TWO_PI * rRight[i] * dzj) / drFace[i + 1];
          rhs += Gout * (Tstar[idx + 1] - Tstar[idx]);
        }
        if (isTop) {
          if (useContact) {
            const Qc = gContactPerCell[i] * (TnTopBuf[i] - Tsteak[i]);
            rhs -= Qc;
          } else {
            rhs += hTopBuf[i] * Tamb;
          }
        }
        if (isBot) {
          if (heaterOn && heatedArea[i] > 0) rhs += qDensity * heatedArea[i];
          if (hBotBuf[i] > 0) rhs += hBotBuf[i] * Tamb;
        }

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

    // ---- Steak ADI (only when active): half-step 1 implicit in r, then
    //      half-step 2 implicit in k. Bottom face couples to the pan via the
    //      same Q_contact_n(i) = G·(T_pan_n_top[i] − T_steak_n_bot[i]) source
    //      that the pan saw, with the opposite sign — total interface flux
    //      over a step = dt·Q_contact_n, internal between pan and steak.
    if (state.steakActive && steakNr > 0 && steakNz > 0) {
      // Linearise air-loss radiation at T_n on the steak's exposed faces and
      // snapshot T_n for the energy tally.
      for (let i = 0; i < steakNr; i++) {
        const Tn = Tsteak[(steakNz - 1) * steakNr + i];
        TnSteakTopBuf[i] = Tn;
        const hRad = epsSteak * SIGMA * (Tn * Tn + Tamb * Tamb) * (Tn + Tamb);
        hSteakTopBuf[i] = (hConv + hRad) * ringAreaSteak[i];
      }
      const sideFaceArea = TWO_PI * rSteakRight[steakNr - 1] * dzSteak;
      for (let kk = 0; kk < steakNz; kk++) {
        const Tn = Tsteak[kk * steakNr + (steakNr - 1)];
        TnSteakSideBuf[kk] = Tn;
        const hRad = epsSteak * SIGMA * (Tn * Tn + Tamb * Tamb) * (Tn + Tamb);
        hSteakSideBuf[kk] = (hConv + hRad) * sideFaceArea;
      }

      const rcDzS = rhoSteak * cpSteakK * dzSteak;
      // Half-step 1: implicit-r, explicit-k (one tridiag per row k, size steakNr).
      for (let kk = 0; kk < steakNz; kk++) {
        const isTopSteak = kk === steakNz - 1;
        const isBotSteak = kk === 0;
        for (let i = 0; i < steakNr; i++) {
          const idx = kk * steakNr + i;
          const A = ringAreaSteak[i];
          const rhocV_dt2 = (rcDzS * A) / halfDt;
          const Gin = i > 0 ? (kSteak * TWO_PI * rSteakLeft[i] * dzSteak) / drSteak : 0;
          const Gout = i < steakNr - 1 ? (kSteak * TWO_PI * rSteakRight[i] * dzSteak) / drSteak : 0;

          tdSub[i] = -Gin;
          tdSup[i] = -Gout;
          let diag = rhocV_dt2 + Gin + Gout;
          // Outer-side air Robin (i = steakNr-1): on the diagonal in the implicit-r half.
          if (i === steakNr - 1) diag += hSteakSideBuf[kk];
          tdDiag[i] = diag;

          let rhs = rhocV_dt2 * Tsteak[idx];
          // Axial (k-direction) conduction at T_n (explicit).
          if (kk > 0) {
            const Gbot = (kSteak * A) / dzSteak;
            rhs += Gbot * (Tsteak[idx - steakNr] - Tsteak[idx]);
          }
          if (kk < steakNz - 1) {
            const Gtop = (kSteak * A) / dzSteak;
            rhs += Gtop * (Tsteak[idx + steakNr] - Tsteak[idx]);
          }
          // Top air Robin (k = steakNz-1) at T_n.
          if (isTopSteak) {
            rhs -= hSteakTopBuf[i] * Tsteak[idx];
            rhs += hSteakTopBuf[i] * Tamb;
          }
          // Outer-side air Robin source.
          if (i === steakNr - 1) rhs += hSteakSideBuf[kk] * Tamb;
          // Bottom contact source (k = 0): +Q_contact_n.
          if (isBotSteak && gContactPerCell[i] > 0) {
            const Qc = gContactPerCell[i] * (TnTopBuf[i] - Tsteak[i]);
            rhs += Qc;
          }
          tdRhs[i] = rhs;
        }
        solveTridiag(tdSub, tdDiag, tdSup, tdRhs, tdSol, tdCprime, steakNr);
        for (let i = 0; i < steakNr; i++) {
          TsteakStar[kk * steakNr + i] = tdSol[i];
        }
      }

      // Half-step 2: implicit-k, explicit-r (one tridiag per column i, size steakNz).
      for (let i = 0; i < steakNr; i++) {
        const A = ringAreaSteak[i];
        const Gin = i > 0 ? (kSteak * TWO_PI * rSteakLeft[i] * dzSteak) / drSteak : 0;
        const Gout = i < steakNr - 1 ? (kSteak * TWO_PI * rSteakRight[i] * dzSteak) / drSteak : 0;
        for (let kk = 0; kk < steakNz; kk++) {
          const idx = kk * steakNr + i;
          const rhocV_dt2 = (rcDzS * A) / halfDt;
          const Gbot = kk > 0 ? (kSteak * A) / dzSteak : 0;
          const Gtop = kk < steakNz - 1 ? (kSteak * A) / dzSteak : 0;
          const isTopSteak = kk === steakNz - 1;
          const isBotSteak = kk === 0;

          tdSub[kk] = -Gbot;
          tdSup[kk] = -Gtop;
          let diag = rhocV_dt2 + Gbot + Gtop;
          if (isTopSteak) diag += hSteakTopBuf[i];
          tdDiag[kk] = diag;

          let rhs = rhocV_dt2 * TsteakStar[idx];
          // Radial (i-direction) conduction at T* (explicit).
          if (i > 0) {
            rhs += Gin * (TsteakStar[idx - 1] - TsteakStar[idx]);
          }
          if (i < steakNr - 1) {
            rhs += Gout * (TsteakStar[idx + 1] - TsteakStar[idx]);
          }
          // Top air Robin constant.
          if (isTopSteak) rhs += hSteakTopBuf[i] * Tamb;
          // Outer-side Robin in this half is explicit-r → put in RHS.
          if (i === steakNr - 1) {
            rhs -= hSteakSideBuf[kk] * TsteakStar[idx];
            rhs += hSteakSideBuf[kk] * Tamb;
          }
          // Bottom contact source (same Qc as in HS1).
          if (isBotSteak && gContactPerCell[i] > 0) {
            const Qc = gContactPerCell[i] * (TnTopBuf[i] - Tsteak[i]);
            rhs += Qc;
          }
          tdRhs[kk] = rhs;
        }
        solveTridiag(tdSub, tdDiag, tdSup, tdRhs, tdSol, tdCprime, steakNz);
        for (let kk = 0; kk < steakNz; kk++) {
          const idx = kk * steakNr + i;
          const diff = tdSol[kk] - Tsteak[idx];
          const ad = diff < 0 ? -diff : diff;
          if (ad > maxDeltaT) maxDeltaT = ad;
          Tsteak[idx] = tdSol[kk];
        }
      }
    }

    // ---- Energy tally (trapezoidal — exact for the applied flux) ----
    // Top face loss for pan cells NOT covered by the steak.
    {
      const skip = state.steakActive ? steakNr : 0;
      for (let i = skip; i < Nr; i++) {
        const Tn = TnTopBuf[i];
        const Tnp1 = T2D[topRowOff + i];
        const dTavg = 0.5 * (Tn + Tnp1) - Tamb;
        const A = ringArea[i];
        const hRad = (hTopBuf[i] - hConv * A) / A;
        eLossConv += hConv * dTavg * A * dt;
        eLossRad += hRad * dTavg * A * dt;
      }
    }
    // Bottom face loss for rim cells only.
    for (let i = nInner; i < Nr; i++) {
      const Tn = TnBotBuf[i];
      const Tnp1 = T2D[i]; // j=0 row
      const dTavg = 0.5 * (Tn + Tnp1) - Tamb;
      const A = ringArea[i];
      const hRad = (hBotBuf[i] - hConv * A) / A;
      eLossConv += hConv * dTavg * A * dt;
      eLossRad += hRad * dTavg * A * dt;
    }
    // Steak air-loss tally (top + outer side faces).
    if (state.steakActive && steakNr > 0 && steakNz > 0) {
      for (let i = 0; i < steakNr; i++) {
        const Tn = TnSteakTopBuf[i];
        const Tnp1 = Tsteak[(steakNz - 1) * steakNr + i];
        const dTavg = 0.5 * (Tn + Tnp1) - Tamb;
        const A = ringAreaSteak[i];
        const hRad = (hSteakTopBuf[i] - hConv * A) / A;
        eLossConv += hConv * dTavg * A * dt;
        eLossRad += hRad * dTavg * A * dt;
      }
      const sideArea = TWO_PI * rSteakRight[steakNr - 1] * dzSteak;
      for (let kk = 0; kk < steakNz; kk++) {
        const Tn = TnSteakSideBuf[kk];
        const Tnp1 = Tsteak[kk * steakNr + (steakNr - 1)];
        const dTavg = 0.5 * (Tn + Tnp1) - Tamb;
        const hRad = (hSteakSideBuf[kk] - hConv * sideArea) / sideArea;
        eLossConv += hConv * dTavg * sideArea * dt;
        eLossRad += hRad * dTavg * sideArea * dt;
      }
    }

    state.time += dt;
    eInput += heaterFactor * heaterPower * dt;

    // Sample T_edge — the top-surface cell at the cooking-zone outer edge —
    // and accumulate into the current cycle's integral.
    const TedgeSub = T2D[topRowOff + nInner - 1];
    state.cycleTedgeIntegral += TedgeSub * dt;

    // Phase-B stopping criterion: the steak is cooked throughout when the
    // coldest cell anywhere in the steak reaches the user's done temperature.
    if (state.steakActive && !state.steady && steakNr > 0 && steakNz > 0) {
      let TsteakMin = Infinity;
      for (let ii = 0; ii < Tsteak.length; ii++) {
        if (Tsteak[ii] < TsteakMin) TsteakMin = Tsteak[ii];
      }
      if (TsteakMin >= params.steakDoneTemp) {
        state.steady = true;
        state.steadyAtTime = state.time;
      }
    }
  }

  state.eInput = eInput;
  state.eLossConv = eLossConv;
  state.eLossRad = eLossRad;
  state.heaterOn = heaterOn;

  // E_stored = Σ ρcV · (T − T_ref) summed over both pan and (when active) steak.
  // Pan cells reference the pan's initial temperature; steak cells reference
  // the steak's initial temperature so eStored is monotonic — it has no jump
  // at the moment the steak is dropped.
  let eStored = 0;
  const T0pan = state.initialTemp;
  for (let j = 0; j < Nz; j++) {
    const rcDz = rho[j] * cp[j] * dz[j];
    const rowOff = j * Nr;
    let rowSum = 0;
    for (let i = 0; i < Nr; i++) {
      rowSum += ringArea[i] * (T2D[rowOff + i] - T0pan);
    }
    eStored += rcDz * rowSum;
  }
  if (state.steakActive && steakNr > 0 && steakNz > 0) {
    const T0s = state.steakInitialTempK;
    const rcDzS = rhoSteak * cpSteakK * dzSteak;
    for (let kk = 0; kk < steakNz; kk++) {
      let rowSum = 0;
      const rowOff = kk * steakNr;
      for (let i = 0; i < steakNr; i++) {
        rowSum += ringAreaSteak[i] * (Tsteak[rowOff + i] - T0s);
      }
      eStored += rcDzS * rowSum;
    }
  }

  // Top-surface temperature stats at the new time. T_max scans only the cooking
  // zone (i < nInner); T_edge is the single cell at the cooking-zone outer edge
  // (i = nInner − 1). Together they characterise the spread on the cooking
  // surface — using the rim cells would mask cooking-surface dynamics.
  let Tmax = -Infinity;
  for (let i = 0; i < nInner; i++) {
    const Ti = T2D[topRowOff + i];
    if (Ti > Tmax) Tmax = Ti;
  }
  const Tcenter = T2D[topRowOff];
  const Tedge = T2D[topRowOff + nInner - 1];

  // Latch "cooking ready" — first time T_edge reaches the Maillard threshold
  // (the cooking-edge cell is the slowest to heat up under a centered heater,
  // so once it has crossed the Maillard temperature the rest of the cooking
  // surface has too). Latched once.
  if (state.cookingReadyAtTime === null && Tedge >= MAILLARD_TEMP_K) {
    state.cookingReadyAtTime = state.time;
  }

  // History sampling rate: take a snapshot only every `historyIntervalSec` of
  // sim time (default 2 s) — typical sims advance many step()s per second of
  // sim time, so this caps history growth and chart-redraw cost without
  // changing any of the underlying accumulators. Always force a push when
  // the steady criterion just latched, so the final point is captured exactly.
  const elapsedSinceLast = state.time - state.lastHistoryTime;
  const justLatched = state.steady && state.steadyAtTime === state.time;
  if (elapsedSinceLast >= state.historyIntervalSec || justLatched) {
    pushHistory(state, {
      t: state.time,
      eIn: eInput,
      eStored,
      eConv: eLossConv,
      eRad: eLossRad,
      Tcenter,
      Tmax,
      Tedge,
      maxDeltaT,
    });
    state.lastHistoryTime = state.time;
  }

  // (Steady-state detection happens at heater rising-edges inside the substep
  // loop above — see the cycle-tracking block.)
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
