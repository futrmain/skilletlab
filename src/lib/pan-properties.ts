import { type PanConfig } from "./configs";

export interface PanDerivedProps {
  // Total pan mass (kg). Base-plate layers count against the cooking-radius
  // area; non-base-plate layers count against the full (cooking + rim) area.
  mass: number;
  // Total volumetric heat capacity Σ ρ·c·V (J/K) — energy required to raise
  // the whole pan by 1 K. Same area rules as `mass`.
  heatCapacity: number;
  // Bulk effective conductivity (W/m·K) for heat flowing vertically through
  // the full stack of layers within the cooking radius (series resistance):
  //     k_eff = Σ t_i  /  Σ (t_i / k_i)
  // All layers contribute since the column within the cooking radius passes
  // through both the base-plate stem and the non-base-plate top slab.
  bulkConductivity: number;
}

export function derivePanProperties(pan: PanConfig): PanDerivedProps {
  const R_cooking = pan.diameter / 2;
  const R_outer = R_cooking + pan.rimHeight;
  const A_cooking = Math.PI * R_cooking * R_cooking;
  const A_outer = Math.PI * R_outer * R_outer;

  let mass = 0;
  let heatCapacity = 0;
  let sumT = 0;
  let sumTOverK = 0;

  for (const layer of pan.layers) {
    const area = layer.basePlate ? A_cooking : A_outer;
    const volume = layer.thickness * area;
    mass += layer.rho * volume;
    heatCapacity += layer.rho * layer.cp * volume;
    sumT += layer.thickness;
    sumTOverK += layer.thickness / Math.max(layer.k, 1e-12);
  }

  const bulkConductivity = sumTOverK > 0 ? sumT / sumTOverK : 0;

  return { mass, heatCapacity, bulkConductivity };
}
