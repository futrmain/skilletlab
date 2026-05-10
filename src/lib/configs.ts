import { useEffect, useState } from "react";
import { MATERIALS, type Layer } from "./simulation";

export interface PanConfig {
  id: string;
  name: string;
  diameter: number; // m — cooking-surface diameter (heater stays inside this)
  rimHeight: number; // m — radial flange past the cooking surface (the pan's rim)
  layers: Layer[];
}

export interface HeaterConfig {
  id: string;
  name: string;
  diameter: number; // m — mean diameter of the heater ring
  thickness: number; // m — radial band width of the heater ring
  power: number; // W
  setpointHigh: number; // °C — heater turns off when center top-surface T ≥ this
  setpointLow: number; // °C — heater turns on when center top-surface T ≤ this
}

const L = (name: string, thickness: number, basePlate?: boolean): Layer => ({
  name,
  thickness,
  ...MATERIALS[name],
  ...(basePlate ? { basePlate: true } : {}),
});

export const PAN_TEMPLATES: PanConfig[] = [
  {
    id: "All-Clad D3",
    name: "All-Clad D3 28cm",
    diameter: 0.28,
    rimHeight: 0.08,
    layers: [L("Stainless 304", 0.00045), L("Aluminum", 0.0017), L("Stainless 304", 0.00045)],
  },
  {
    id: "Falk Classical (Cu)",
    name: "Falk Classical (Cu)",
    diameter: 0.28,
    rimHeight: 0.08,
    layers: [L("Copper", 0.0023),  L("Stainless 304", 0.0002)],
  },
  {
    id: "Falk Cu Coeur",
    name: "Falk Cu Coeur",
    diameter: 0.28,
    rimHeight: 0.08,
    layers: [L("Stainless 304", 0.0004), L("Copper", 0.0019)],
  },
  {
    id: "tpl-cast-iron",
    name: "Cast Iron Skillet 28cm",
    diameter: 0.28,
    rimHeight: 0.08,
    layers: [L("Cast Iron", 0.005)],
  },
  {
    id: "tpl-carbon-steel",
    name: "Carbon Steel 28cm",
    diameter: 0.28,
    rimHeight: 0.08,
    layers: [L("Carbon Steel", 0.0025)],
  },
  {
    id: "ikea-365",
    name: "IKEA 365+",
    diameter: 0.28,
    rimHeight: 0.08,
    layers: [
      
      L("Stainless 304", 0.0004, true),
      L("Aluminum", 0.0022, true),
      L("Stainless 304", 0.0004, true),
      L("Stainless 304", 0.00184),
    ],
  },
];

export const HEATER_TEMPLATES: HeaterConfig[] = [
  {
    id: "tpl-gas-small",
    name: "Gas burner — small",
    diameter: 0.08,
    thickness: 0.02,
    power: 1500,
    setpointHigh: 300,
    setpointLow: 280,
  },
  {
    id: "tpl-gas-medium",
    name: "Gas burner — medium",
    diameter: 0.12,
    thickness: 0.025,
    power: 2500,
    setpointHigh: 300,
    setpointLow: 280,
  },
  {
    id: "tpl-gas-large",
    name: "Gas burner — large (wok)",
    diameter: 0.16,
    thickness: 0.03,
    power: 4000,
    setpointHigh: 300,
    setpointLow: 280,
  },
  {
    id: "tpl-induction",
    name: "Induction hob 15cm",
    diameter: 0.15,
    thickness: 0.02,
    power: 2200,
    setpointHigh: 300,
    setpointLow: 280,
  },
  {
    id: "tpl-electric-coil",
    name: "Electric coil 18cm",
    diameter: 0.16,
    thickness: 0.012,
    power: 1800,
    setpointHigh: 300,
    setpointLow: 280,
  },
];

const PAN_KEY = "skillet.pans.v4";
const HEATER_KEY = "skillet.heaters.v4";

function load<T>(key: string, fallback: T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

export function usePanConfigs() {
  const [pans, setPans] = useState<PanConfig[]>(() => load(PAN_KEY, PAN_TEMPLATES));
  useEffect(() => {
    try {
      localStorage.setItem(PAN_KEY, JSON.stringify(pans));
    } catch {}
  }, [pans]);
  return [pans, setPans] as const;
}

export function useHeaterConfigs() {
  const [heaters, setHeaters] = useState<HeaterConfig[]>(() => load(HEATER_KEY, HEATER_TEMPLATES));
  useEffect(() => {
    try {
      localStorage.setItem(HEATER_KEY, JSON.stringify(heaters));
    } catch {}
  }, [heaters]);
  return [heaters, setHeaters] as const;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
