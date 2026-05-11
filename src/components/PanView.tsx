import { useEffect, useRef } from "react";
import { thermalColorRGBA } from "@/lib/colormap";

interface Props {
  T: Float64Array;
  r: Float64Array;
  panRadius: number;
  heaterRadius: number; // mean radius of the heater ring
  heaterThickness: number; // radial band width of the heater ring
  tMin: number;
  tMax: number;
  size?: number;
}

export function PanView({
  T,
  r,
  panRadius,
  heaterRadius,
  heaterThickness,
  tMin,
  tMax,
  size = 380,
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
        // interp T at rPhys
        const dr = r[1] - r[0];
        const fi = rPhys / dr;
        const i0 = Math.floor(fi);
        const i1 = Math.min(T.length - 1, i0 + 1);
        const f = fi - i0;
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

    // pan rim
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.stroke();
  }, [T, r, panRadius, heaterRadius, heaterThickness, tMin, tMax]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
