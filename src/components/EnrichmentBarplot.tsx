// EnrichmentBarplot.tsx — SVG-quality output with visx tooltip
// ---------------------------------------------------------------------------
//  • Imperative API: highlightCluster(cid), highlightGene(gid), exportAsSVG()
//  • Responsive container via @visx/responsive
//  • Proper cluster-based ordering and coloring
//  • Duplicate pathway labels allowed
//  • Tooltip on hover showing full pathway metadata

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useMemo,
  MouseEvent,
} from 'react';
import { Group } from '@visx/group';
import { AxisLeft, AxisTop, AxisBottom } from '@visx/axis';
import { scaleLinear, scaleBand } from '@visx/scale';
import { ParentSize } from '@visx/responsive';
import { localPoint } from '@visx/event';
import {
  useTooltip,
  TooltipWithBounds,
  defaultStyles as tooltipDefault,
} from '@visx/tooltip';

export interface Pathway {
  cluster: number;
  pathway: string;
  pathwayId: string;
  source: string;
  fdr: number;
  genes: string[];
}

interface Props {
  data: Pathway[];
  palette: Record<number, string>;
  onBarHover?: (p: Pathway | null) => void;
  fdrThreshold?: number;
}

export interface EnrichmentBarplotHandle {
  highlightCluster(cid: number | null): void;
  highlightGene(gid: string | null): void;
  exportAsSVG(): void;
}

const MAX_LABEL = 50;
const truncate = (s: string) =>
  s.length > MAX_LABEL ? s.slice(0, MAX_LABEL - 1) + '…' : s;

const toLog10 = (f: number) => -Math.log10(f);

const BAR_HEIGHT = 15;

const MARGIN = { top: 40, right: 20, bottom: 40, left: 270 };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const EnrichmentBarplot = forwardRef<EnrichmentBarplotHandle, Props>(
  ({ data, palette, onBarHover, fdrThreshold = 0.05 }, ref) => {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [hoverCid, setHoverCid] = useState<number | null>(null);
    const [activeCid, setActiveCid] = useState<number | null>(null);
    const [activeGene, setActiveGene] = useState<string | null>(null);

    // --- Tooltip -----------------------------------------------------------
    const {
      tooltipOpen,
      tooltipData,
      tooltipLeft,
      tooltipTop,
      showTooltip,
      hideTooltip,
    } = useTooltip<Pathway>();

    // --- Derived data ------------------------------------------------------
    const rows = useMemo(
      () =>
        data
          .map(d => ({
            id: `${d.cluster}|${d.pathwayId}`,
            ...d,
            logFdr: toLog10(d.fdr),
          }))
          .sort((a, b) => a.cluster - b.cluster),
      [data],
    );

    const height = rows.length * BAR_HEIGHT + MARGIN.top + MARGIN.bottom;

    // --- Imperative handle -------------------------------------------------
    useImperativeHandle(ref, () => ({
      highlightCluster(cid) {
        setActiveGene(null);
        setActiveCid(cid);
      },
      highlightGene(g) {
        setActiveCid(null);
        setActiveGene(g);
      },
      exportAsSVG() {
        if (!svgRef.current) return;
        const svgString = new XMLSerializer().serializeToString(svgRef.current);
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'enrichment.svg';
        a.click();
        URL.revokeObjectURL(url);
      },
    }));

    // ----------------------------------------------------------------------
    return (
      <div className="w-full h-full overflow-y-auto relative">
        <ParentSize>
          {({ width }) => {
            const yScale = scaleBand({
              domain: rows.map(d => d.id),
              range: [MARGIN.top, height - MARGIN.bottom],
              padding: 0.15,
            });

            const xScale = scaleLinear<number>({
              domain: [0, Math.max(...rows.map(d => d.logFdr)) + 0.5],
              range: [MARGIN.left, width - MARGIN.right],
            });

            // ------------------------------------------ render SVG
            return (
              <>
                <svg ref={svgRef} width={width} height={height}>
                  <Group>
                    <AxisTop
                      top={MARGIN.top}
                      scale={xScale}
                      numTicks={5}
                      tickFormat={v => v.toFixed(1)}
                      label="-log₁₀(FDR)"
                    />
                    <AxisBottom
                      top={height - MARGIN.bottom}
                      scale={xScale}
                      numTicks={5}
                      tickFormat={v => v.toFixed(1)}
                      label="-log₁₀(FDR)"
                    />
                    <AxisLeft
                      left={MARGIN.left - 2}
                      scale={yScale}
                      numTicks={rows.length}
                      tickFormat={id => truncate(rows.find(r => r.id === id)?.pathway ?? '')}
                    />

                    {/* Bars */}
                    {rows.map(r => {
                      const y = yScale(r.id);
                      if (y === undefined) return null;

                      const highlightByCluster = activeCid !== null && r.cluster === activeCid;
                      const highlightByGene =
                        activeGene !== null && r.genes.includes(activeGene);
                      const highlightByHover = r.cluster === hoverCid;

                      const stroke =
                        highlightByCluster || highlightByGene || highlightByHover
                          ? '#000'
                          : 'none';

                      /** Mouse move/enter handler */
                      const handleMove = (evt: MouseEvent<SVGRectElement>) => {
                        const coords = localPoint(evt);
                        if (!coords) return;
                        showTooltip({
                          tooltipLeft: coords.x + 10, // small offset
                          tooltipTop: coords.y,
                          tooltipData: r,
                        });
                      };

                      return (
                        <Group key={r.id}>
                          <rect
                            x={xScale(0)}
                            y={y}
                            height={yScale.bandwidth()}
                            width={xScale(r.logFdr) - xScale(0)}
                            fill={palette[r.cluster] ?? '#ccc'}
                            stroke={stroke}
                            strokeWidth={stroke !== 'none' ? 2 : 1}
                            onMouseEnter={evt => {
                              setHoverCid(r.cluster);
                              onBarHover?.(r);
                              handleMove(evt);
                            }}
                            onMouseMove={handleMove}
                            onMouseLeave={() => {
                              setHoverCid(null);
                              hideTooltip();
                              onBarHover?.(null);
                            }}
                          />
                        </Group>
                      );
                    })}

                    {/* Threshold line */}
                    <line
                      x1={xScale(toLog10(fdrThreshold))}
                      x2={xScale(toLog10(fdrThreshold))}
                      y1={MARGIN.top}
                      y2={height - MARGIN.bottom}
                      stroke="grey"
                      strokeWidth={2}
                      strokeDasharray="3 3"
                    />
                  </Group>
                </svg>

                {/* Tooltip overlay */}
                {tooltipOpen && tooltipData && (
                  <TooltipWithBounds
                    top={tooltipTop}
                    left={tooltipLeft}
                    style={{
                      ...tooltipDefault,
                      backgroundColor: '#fff',
                      color: '#000',
                      border: '1px solid #666',
                      borderRadius: 4,
                      padding: '6px 8px',
                      maxWidth: 260,
                      fontSize: 12,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                      pointerEvents: 'none',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {tooltipData.pathway}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <div>ID: {tooltipData.pathwayId}</div>
                      <div>Source: {tooltipData.source}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            background: palette[tooltipData.cluster] ?? '#ccc',
                            borderRadius: 2,
                          }}
                        />
                        Cluster {tooltipData.cluster}
                      </div>
                      <div>
                        FDR ≈ {tooltipData.fdr.toExponential(2)}
                      </div>
                      <div>
                        -log<sub>10</sub>(FDR): {tooltipData.logFdr.toFixed(2)}
                      </div>
                    </div>
                  </TooltipWithBounds>
                )}
              </>
            );
          }}
        </ParentSize>
      </div>
    );
  },
);

EnrichmentBarplot.displayName = 'EnrichmentBarplot';
export default EnrichmentBarplot;
