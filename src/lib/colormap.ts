// Thermal colormap: dark blue -> purple -> red -> orange -> yellow -> white
export function thermalColor(t: number): string {
  // t in [0,1]
  const x = Math.max(0, Math.min(1, t));
  const stops: [number, [number, number, number]][] = [
    [0.0, [10, 12, 40]],
    [0.2, [70, 20, 110]],
    [0.4, [180, 30, 80]],
    [0.6, [240, 90, 30]],
    [0.8, [255, 190, 60]],
    [1.0, [255, 255, 230]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (x <= b) {
      const f = (x - a) / (b - a);
      const r = Math.round(ca[0] + (cb[0] - ca[0]) * f);
      const g = Math.round(ca[1] + (cb[1] - ca[1]) * f);
      const bl = Math.round(ca[2] + (cb[2] - ca[2]) * f);
      return `rgb(${r},${g},${bl})`;
    }
  }
  return "rgb(255,255,255)";
}

export function thermalColorRGBA(t: number, out: Uint8ClampedArray, off: number) {
  const x = Math.max(0, Math.min(1, t));
  const stops: [number, [number, number, number]][] = [
    [0.0, [10, 12, 40]],
    [0.2, [70, 20, 110]],
    [0.4, [180, 30, 80]],
    [0.6, [240, 90, 30]],
    [0.8, [255, 190, 60]],
    [1.0, [255, 255, 230]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i];
    const [b, cb] = stops[i + 1];
    if (x <= b) {
      const f = (x - a) / (b - a);
      out[off] = ca[0] + (cb[0] - ca[0]) * f;
      out[off + 1] = ca[1] + (cb[1] - ca[1]) * f;
      out[off + 2] = ca[2] + (cb[2] - ca[2]) * f;
      out[off + 3] = 255;
      return;
    }
  }
  out[off] = 255;
  out[off + 1] = 255;
  out[off + 2] = 230;
  out[off + 3] = 255;
}
