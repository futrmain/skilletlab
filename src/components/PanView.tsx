import { useEffect, useRef } from "react";
import { thermalColorRGBA } from "@/lib/colormap";
import { ChartHoverOverlay } from "./ChartHoverOverlay";

interface PanViewHover {
  T: Float64Array;
  r: Float64Array;
  cx: number;
  cy: number;
  radiusPx: number;
  panRadius: number;
  // Heatmap occupies x in [0, heatmapW] of the wrapping div.
  heatmapW: number;
}

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
  const hoverRef = useRef<PanViewHover | null>(null);

  // Internal: total canvas width = heatmap diameter (`size`) + colorbar strip.
  const colorbarStripW = 44;
  const canvasW = size + colorbarStripW;
  const canvasH = size;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const heatmapW = size; // first `size` pixels host the circular heatmap
    const img = ctx.createImageData(w, h);
    const cx = heatmapW / 2;
    const cy = h / 2;
    const radiusPx = Math.min(heatmapW, h) / 2 - 8;
    const range = Math.max(1e-6, tMax - tMin);

    const N = T.length;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < heatmapW; x++) {
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

    // ---- Colorbar strip (right side) ----
    const stripX = heatmapW + 6;
    const stripW = 12;
    const stripY = Math.round(h * 0.08);
    const stripH = h - 2 * stripY;
    // Fill the gradient row by row using the same thermal colormap.
    const tmp = new Uint8ClampedArray(4);
    for (let py = 0; py < stripH; py++) {
      const norm = 1 - py / Math.max(1, stripH - 1); // 0 at bottom → 1 at top
      thermalColorRGBA(norm, tmp, 0);
      ctx.fillStyle = `rgba(${tmp[0]},${tmp[1]},${tmp[2]},${tmp[3] / 255})`;
      ctx.fillRect(stripX, stripY + py, stripW, 1);
    }
    // Outline.
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(stripX + 0.5, stripY + 0.5, stripW - 1, stripH - 1);

    // Labels (°C). Fit comfortably to the right of the strip.
    ctx.fillStyle = "rgba(220,220,220,0.85)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const labelX = stripX + stripW + 3;
    const tMinC = tMin - 273.15;
    const tMaxC = tMax - 273.15;
    const tMidC = (tMinC + tMaxC) * 0.5;
    ctx.fillText(`${tMaxC.toFixed(0)}°`, labelX, stripY + 4);
    ctx.fillText(`${tMidC.toFixed(0)}°`, labelX, stripY + stripH / 2);
    ctx.fillText(`${tMinC.toFixed(0)}°`, labelX, stripY + stripH - 4);
    // Reset baseline so we don't surprise other ctx state outside this effect.
    ctx.textBaseline = "alphabetic";

    hoverRef.current = { T, r, cx, cy, radiusPx, panRadius, heatmapW };
  }, [T, r, panRadius, cookingRadius, heaterRadius, heaterThickness, tMin, tMax, tick, size]);

  return (
    <div
      className="relative inline-block"
      style={{ width: canvasW, height: canvasH }}
    >
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        style={{ width: canvasW, height: canvasH, display: "block" }}
      />
      <ChartHoverOverlay
        width={canvasW}
        height={canvasH}
        resolve={(px, py) => {
          const d = hoverRef.current;
          if (!d || d.T.length === 0) return null;
          // Only respond over the heatmap region; ignore the colorbar strip.
          if (px > d.heatmapW) return null;
          const dx = px - d.cx;
          const dy = py - d.cy;
          const dPx = Math.sqrt(dx * dx + dy * dy);
          if (dPx > d.radiusPx) return null;
          const rPhys = (dPx / d.radiusPx) * d.panRadius;
          // Nearest cell-center.
          let lo = 0;
          let hi = d.r.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (d.r[mid] < rPhys) lo = mid + 1;
            else hi = mid;
          }
          let idx = lo;
          if (lo > 0 && Math.abs(d.r[lo - 1] - rPhys) < Math.abs(d.r[lo] - rPhys)) idx = lo - 1;
          return {
            x: px,
            noHairline: true,
            content: (
              <div className="space-y-0.5">
                <div className="text-muted-foreground">r ≈ {(rPhys * 100).toFixed(2)} cm</div>
                <div style={{ color: "oklch(0.78 0.18 75)" }}>T = {(d.T[idx] - 273.15).toFixed(1)}°C</div>
              </div>
            ),
          };
        }}
      />
    </div>
  );
}
