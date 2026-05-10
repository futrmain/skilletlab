import { useState, type ReactNode } from "react";

export interface HoverInfo {
  // Pixel position of the hovered data point (used to draw hairline + dot).
  x: number;
  y?: number;
  // Suppress the vertical hairline (e.g. on 2-D heatmaps where a vertical
  // line carries no meaning). Tooltip and dot are unaffected.
  noHairline?: boolean;
  // Tooltip body — already-formatted React content.
  content: ReactNode;
}

interface Props {
  width: number;
  height: number;
  // Called on every mousemove with cursor coords (CSS px relative to the
  // overlay div). Return null to hide the tooltip for this position.
  resolve: (px: number, py: number) => HoverInfo | null;
}

// Transparent overlay that renders a hairline + dot + tooltip on top of a
// canvas chart. The chart owns its rendering and exposes a `resolve` function
// that maps cursor pixels to a HoverInfo (or null when outside the plot area).
export function ChartHoverOverlay({ width, height, resolve }: Props) {
  const [info, setInfo] = useState<HoverInfo | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      className="absolute inset-0"
      style={{ width, height }}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const r = resolve(px, py);
        if (r) {
          setInfo(r);
          setCursor({ x: px, y: py });
        } else if (info) {
          setInfo(null);
          setCursor(null);
        }
      }}
      onMouseLeave={() => {
        setInfo(null);
        setCursor(null);
      }}
    >
      {info && cursor && (
        <>
          <svg
            width={width}
            height={height}
            className="absolute inset-0 pointer-events-none"
          >
            {!info.noHairline && (
              <line
                x1={info.x}
                x2={info.x}
                y1={0}
                y2={height}
                stroke="rgba(220, 220, 220, 0.5)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}
            {info.y != null && (
              <circle
                cx={info.x}
                cy={info.y}
                r={3.5}
                fill="white"
                stroke="rgba(0, 0, 0, 0.65)"
                strokeWidth={1}
              />
            )}
          </svg>
          <div
            className="absolute pointer-events-none rounded-md border border-border bg-popover px-2 py-1 text-[10px] font-mono text-popover-foreground shadow-md whitespace-nowrap"
            style={{
              left: cursor.x + 140 > width ? Math.max(4, cursor.x - 144) : cursor.x + 12,
              top: Math.max(4, Math.min(cursor.y - 8, height - 70)),
            }}
          >
            {info.content}
          </div>
        </>
      )}
    </div>
  );
}
