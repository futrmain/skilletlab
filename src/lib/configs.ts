import { useEffect, useState } from "react";
import { MATERIALS, type Layer } from "./simulation";

export interface PanConfig {
  id: string;
  name: string;
  diameter: number; // m
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

const L = (name: string, thickness: number): Layer => ({
  name,
  thickness,
  ...MATERIALS[name],
});

export const PAN_TEMPLATES: PanConfig[] = [
  {
    id: "tpl-tri-ply",
    name: "Tri-Ply Stainless 26cm",
    diameter: 0.26,
    layers: [L("Stainless 304", 0.0005), L("Aluminum", 0.004), L("Stainless 304", 0.0005)],
  },
  {
    id: "tpl-cast-iron",
    name: "Cast Iron Skillet 26cm",
    diameter: 0.26,
    layers: [L("Cast Iron", 0.005)],
  },
  {
    id: "tpl-carbon-steel",
    name: "Carbon Steel 28cm",
    diameter: 0.28,
    layers: [L("Carbon Steel", 0.0025)],
  },
  {
    id: "tpl-copper-core",
    name: "Copper Core 24cm",
    diameter: 0.24,
    layers: [
      L("Stainless 304", 0.0005),
      L("Copper", 0.002),
      L("Aluminum", 0.001),
      L("Stainless 304", 0.0005),
    ],
  },
  {
    id: "tpl-aluminum",
    name: "Aluminum Nonstick 28cm",
    diameter: 0.28,
    layers: [L("Aluminum", 0.0035)],
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
    name: "Induction hob 21cm",
    diameter: 0.18,
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

const PAN_KEY = "skillet.pans.v1";
const HEATER_KEY = "skillet.heaters.v3";

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
