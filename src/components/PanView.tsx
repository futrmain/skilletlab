import { useEffect, useRef } from "react";
import { thermalColorRGBA } from "@/lib/colormap";

interface Props {
  T: Float64Array;
  r: Float64Array;
  panRadius: number; // total physical radius (cooking + rim)
  cookingRadius?: number; // cooking-edge radius (drawn as dashed inner ring)
  heaterRadius: number; // mean radius of the heater ring
  heaterThickness: number; // radial band width of the heater ring
  tMin: number;
  tMax: number;
  size?: number;
  // Per-tick signal (e.g. state.time) so the heat-map redraws even when T/r
  // refs stay stable (their contents mutate in place).
  tick?: number;
}

export function PanView({
  T,
  r,
  panRadius,
  cookingRadius,
  heaterRadius,
  heaterThickness,
  tMin,
  tMax,
  size = 380,
  tick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const img = ctx.createImageData(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const radiusPx = Math.min(w, h) / 2 - 8;
    const range = Math.max(1e-6, tMax - tMin);

    const N = T.length;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const off = (y * w + x) * 4;
        if (d > radiusPx) {
          img.data[off] = 0;
          img.data[off + 1] = 0;
          img.data[off + 2] = 0;
          img.data[off + 3] = 0;
          continue;
        }
        const rPhys = (d / radiusPx) * panRadius;
        // Binary search for the bracketing cell-center pair (works for the
        // non-uniform mesh introduced by the cooking-zone / rim split).
        let i0 = 0;
        let i1 = N - 1;
        if (rPhys <= r[0]) {
          i0 = 0;
          i1 = 0;
        } else if (rPhys >= r[N - 1]) {
          i0 = N - 1;
          i1 = N - 1;
        } else {
          let lo = 0;
          let hi = N - 1;
          while (lo < hi - 1) {
            const mid = (lo + hi) >>> 1;
            if (r[mid] <= rPhys) lo = mid;
            else hi = mid;
          }
          i0 = lo;
          i1 = hi;
        }
        const span = r[i1] - r[i0];
        const f = span > 0 ? (rPhys - r[i0]) / span : 0;
        const Tv = T[i0] * (1 - f) + T[i1] * f;
        const norm = (Tv - tMin) / range;
        thermalColorRGBA(norm, img.data, off);
      }
    }
    ctx.putImageData(img, 0, 0);

    // heater ring outline (inner + outer edges of the annulus)
    const ringIn = Math.max(0, heaterRadius - heaterThickness / 2);
    const ringOut = Math.min(panRadius, heaterRadius + heaterThickness / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    if (ringOut > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, (ringOut / panRadius) * radiusPx, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (ringIn > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, (ringIn / panRadius) * radiusPx, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Cooking-edge marker (dashed) — boundary between cooking zone and the
    // air-cooled rim flange.
    if (cookingRadius && cookingRadius > 0 && cookingRadius < panRadius) {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy, (cookingRadius / panRadius) * radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // pan outer edge (outer edge of rim)
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
  }, [T, r, panRadius, cookingRadius, heaterRadius, heaterThickness, tMin, tMax, tick]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
