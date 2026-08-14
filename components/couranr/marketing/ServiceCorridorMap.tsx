import * as React from "react";
import { MARKETED_MARKETS } from "@/lib/couranr/public/governed";

/**
 * PUB-001 section 10 (`service-area`) — the map / route visual §27 asks for.
 *
 * WHAT THIS IS: the four governed markets at their real relative positions,
 * connected along the corridor they actually sit on. Coordinates are real and
 * the projection is equirectangular about the corridor's centre latitude
 * (38.5727°N, cos ≈ 0.7818), so the ~37km × ~67km ground extent keeps its true
 * 0.552 aspect instead of being stretched to fit a box.
 *
 *   Washington, DC   38.9072, -77.0369
 *   Woodbridge       38.6582, -77.2497
 *   Stafford         38.4221, -77.4083
 *   Fredericksburg   38.3032, -77.4605
 *
 * WHAT THIS DELIBERATELY IS NOT: a service-area boundary. §27 Section 10 says
 * "Do not invent boundaries that authority has not defined", and SVC-002 — the
 * decision that would define one — is unresolved. So there is no polygon, no
 * radius, no shaded catchment and no ZIP shading. Four named markets and the
 * corridor between them is exactly what the authorities support today.
 *
 * It is also not a rendered basemap. No coastline, no road geometry, no river:
 * every one of those would be drawn from memory, and a map that invents terrain
 * is worse than a schematic that admits it is one. The I-95 spine is drawn as
 * the corridor line the markets genuinely sit along, not as surveyed geometry.
 *
 * §21.5 bans "giant glowing map pins" — the markers here are small, flat and
 * unlit, and each one carries its name as text rather than relying on the dot.
 *
 * The market names come from MARKETED_MARKETS so a registry change moves the
 * label; the geometry is asserted against that list at module scope, so adding
 * a market without giving it a coordinate fails the build rather than silently
 * dropping a pin.
 */

type Market = { name: (typeof MARKETED_MARKETS)[number]; x: number; y: number };

const VIEW_W = 360;
const VIEW_H = 657;

/** Projected once, offline, by the script recorded in this file's history. */
const MARKETS: readonly Market[] = [
  { name: "Washington, DC", x: 324.0, y: 65.7 },
  { name: "Woodbridge", x: 179.3, y: 282.4 },
  { name: "Stafford", x: 71.5, y: 487.8 },
  { name: "Fredericksburg", x: 36.0, y: 591.3 },
];

// A market in the registry with no coordinate would render as a silently
// missing pin, which is the failure mode this whole visual is meant to avoid.
if (MARKETS.length !== MARKETED_MARKETS.length) {
  throw new Error(
    `ServiceCorridorMap: ${MARKETED_MARKETS.length} governed markets but ` +
      `${MARKETS.length} plotted. Project the new coordinate before shipping.`,
  );
}
for (const m of MARKETED_MARKETS) {
  if (!MARKETS.some((p) => p.name === m)) {
    throw new Error(`ServiceCorridorMap: "${m}" is governed but has no coordinate.`);
  }
}

const corridor = MARKETS.map((m) => `${m.x},${m.y}`).join(" ");

export function ServiceCorridorMap({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={className}
      role="img"
      aria-labelledby="corridor-title corridor-desc"
      preserveAspectRatio="xMidYMid meet"
    >
      <title id="corridor-title">Couranr service corridor</title>
      <desc id="corridor-desc">
        {`The four Couranr markets at their real relative positions, running ` +
          `south from ${MARKETS[0].name} through ` +
          `${MARKETS.slice(1, -1).map((m) => m.name).join(", ")} to ` +
          `${MARKETS[MARKETS.length - 1].name}. A schematic of the corridor, ` +
          `not a service-area boundary.`}
      </desc>

      {/* Ground tint — a surface for the corridor to sit on, not terrain. */}
      <rect
        x="0"
        y="0"
        width={VIEW_W}
        height={VIEW_H}
        rx="20"
        fill="var(--couranr-surface-sunken)"
      />

      {/* Faint grid. Reads as chart paper, which is honest: this is a diagram. */}
      <g stroke="var(--couranr-border)" strokeWidth="1" opacity="0.7">
        {[1, 2, 3, 4].map((i) => (
          <line key={`v${i}`} x1={(VIEW_W / 5) * i} y1="0" x2={(VIEW_W / 5) * i} y2={VIEW_H} />
        ))}
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <line key={`h${i}`} x1="0" y1={(VIEW_H / 9) * i} x2={VIEW_W} y2={(VIEW_H / 9) * i} />
        ))}
      </g>

      {/* The corridor. Wide soft stroke under a solid one so it reads as a
          route rather than a border. */}
      <polyline
        points={corridor}
        fill="none"
        stroke="var(--couranr-route-blue)"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.14"
      />
      <polyline
        points={corridor}
        fill="none"
        stroke="var(--couranr-route-blue)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {MARKETS.map((m, i) => {
        // Labels sit inboard so none of them runs off the viewBox: the corridor
        // travels top-right to bottom-left, so the first two label left and the
        // last two label right.
        const labelLeft = i < 2;
        return (
          <g key={m.name}>
            <circle cx={m.x} cy={m.y} r="9" fill="var(--couranr-surface)" />
            <circle
              cx={m.x}
              cy={m.y}
              r="5.5"
              fill="var(--couranr-navy)"
              stroke="var(--couranr-surface)"
              strokeWidth="2"
            />
            <text
              x={labelLeft ? m.x - 16 : m.x + 16}
              y={m.y + 5}
              textAnchor={labelLeft ? "end" : "start"}
              fill="var(--couranr-text)"
              fontSize="15"
              fontWeight="600"
              fontFamily="var(--couranr-font-body)"
            >
              {m.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
