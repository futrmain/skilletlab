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
// Energy balance per cell, explicit forward Euler:
//   ρ c V (T_new - T)/dt = Σ_faces (A_face / R_face) (T_neighbor - T)
//                        + Q_heater   (z=0, only on annular ring overlap)
//                        - Q_top      (top face: h_conv + linearised radiation)
// Boundary conditions:
//   r=0     : symmetry (face area is zero — automatic).
//   r=R     : adiabatic (no flux on rim).
//   z=0     : heater q″ on the annular ring [D/2−t/2, D/2+t/2] (clamped to pan);
//             adiabatic everywhere else on the bottom face.
//   z=H     : convective h_conv·(T−T_amb) + radiative ε·σ·(T⁴−T_amb⁴), with ε
//             taken from the topmost material layer.
// Face resistance (per unit area, m²K/W):
//   - Radial face within a layer: R = dr / k_layer
//   - Axial face between cells j and j+1: R = dz_j/(2 k_j) + dz_{j+1}/(2 k_{j+1})
//
// Stability: dt = 0.4 / (2 α_max (1/dr² + 1/dz_min²)).
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
  scratchTnew: Float64Array; // reused buffer for explicit update
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

  // ---- Stability-bound dt for explicit FV ------------------------------
  let alphaMax = 0;
  let dzMin = Infinity;
  for (let j = 0; j < Nz; j++) {
    alphaMax = Math.max(alphaMax, k[j] / (rho[j] * cp[j]));
    if (dz[j] < dzMin) dzMin = dz[j];
  }
  const invStab = 2 * alphaMax * (1 / (dr * dr) + 1 / (dzMin * dzMin));
  const dt = 0.4 / Math.max(invStab, 1e-12);

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
    scratchTnew: new Float64Array(nr * Nz),
    heaterOn: true,

    eInput: 0,
    eLossConv: 0,
    eLossRad: 0,
    initialTemp,
    history: [{ t: 0, eIn: 0, eStored: 0, eConv: 0, eRad: 0 }],
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
    scratchTnew,
  } = state;
  const Tnew = scratchTnew;
  const Tamb = params.ambient;
  const hConv = params.hConv;
  const heaterPower = params.heaterPower;
  // Normalize setpoints in case the user inverted them (low > high) so
  // hysteresis still works rather than getting stuck.
  const setHigh = Math.max(params.setpointHigh, params.setpointLow);
  const setLow = Math.min(params.setpointHigh, params.setpointLow);
  const TWO_PI = 2 * Math.PI;
  const topRowOff = (Nz - 1) * Nr;

  let eInput = state.eInput;
  let eLossConv = state.eLossConv;
  let eLossRad = state.eLossRad;
  let heaterOn = state.heaterOn;

  for (let s = 0; s < substeps; s++) {
    // Hysteresis on center-of-top-surface temperature
    const Tcenter = T2D[topRowOff];
    if (heaterOn && Tcenter >= setHigh) heaterOn = false;
    else if (!heaterOn && Tcenter <= setLow) heaterOn = true;
    const heaterFactor = heaterOn ? 1 : 0;

    for (let j = 0; j < Nz; j++) {
      const kj = k[j];
      const dzj = dz[j];
      const rcDz = rho[j] * cp[j] * dzj; // ρ c dz  (J/m²·K)
      const rowOff = j * Nr;
      const RbotR = j > 0 ? axialFaceR[j - 1] : 0;
      const RtopR = j < Nz - 1 ? axialFaceR[j] : 0;
      const isTop = j === Nz - 1;

      for (let i = 0; i < Nr; i++) {
        const idx = rowOff + i;
        const Tij = T2D[idx];
        let Q = 0; // net heat in (W)

        // Radial inner face (between i-1 and i). At i=0 area is zero (axis).
        if (i > 0) {
          const A = TWO_PI * rLeft[i] * dzj;
          Q += ((kj * A) / dr) * (T2D[idx - 1] - Tij);
        }
        // Radial outer face — adiabatic at the rim (i = Nr-1)
        if (i < Nr - 1) {
          const A = TWO_PI * rRight[i] * dzj;
          Q += ((kj * A) / dr) * (T2D[idx + 1] - Tij);
        }

        // Axial bottom face
        if (j > 0) {
          Q += (ringArea[i] / RbotR) * (T2D[idx - Nr] - Tij);
        } else {
          // Pan bottom: heater on the annular ring (gated by hysteresis);
          // adiabatic elsewhere.
          if (heaterOn && heatedArea[i] > 0) {
            Q += qDensity * heatedArea[i];
          }
        }

        // Axial top face: convection + radiation (ε from top material layer)
        if (!isTop) {
          Q += (ringArea[i] / RtopR) * (T2D[idx + Nr] - Tij);
        } else {
          const hRad = epsTop * SIGMA * (Tij * Tij + Tamb * Tamb) * (Tij + Tamb);
          const dT = Tij - Tamb;
          const A = ringArea[i];
          Q -= (hConv + hRad) * dT * A;
          // Tally cumulative top-surface losses with the same flux that was applied
          eLossConv += hConv * dT * A * dt;
          eLossRad += hRad * dT * A * dt;
        }

        // ρcV = (ρ c dz) · ringArea
        Tnew[idx] = Tij + (dt * Q) / (rcDz * ringArea[i]);
      }
    }
    T2D.set(Tnew);
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

  pushHistory(state, {
    t: state.time,
    eIn: eInput,
    eStored,
    eConv: eLossConv,
    eRad: eLossRad,
  });
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
