// EnrichmentBarplot.tsx — migrated to visx for SVG-quality output
// ---------------------------------------------------------------------------
// • Imperative API: highlightCluster(cid), highlightGene(gid), exportAsSVG()
// • Responsive container via @visx/responsive
// • Proper cluster-based ordering and coloring
// • Duplicate pathway labels allowed

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useMemo
} from 'react';
import { Group } from '@visx/group';
import { AxisLeft, AxisTop, AxisBottom } from '@visx/axis';
import { scaleLinear, scaleBand } from '@visx/scale';
import { ParentSize } from '@visx/responsive';
import { Text } from '@visx/text';
import { localPoint } from '@visx/event';

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
const MARGIN = { top: 40, right: 20, bottom: 40, left: 250 };

const EnrichmentBarplot = forwardRef<EnrichmentBarplotHandle, Props>(
  ({ data, palette, onBarHover, fdrThreshold = 0.05 }, ref) => {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [hoverCid, setHoverCid] = useState<number | null>(null);
    const [activeCid, setActiveCid] = useState<number | null>(null);
    const [activeGene, setActiveGene] = useState<string | null>(null);

    const rows = useMemo(() => {
      return data.map((d) => ({
        id: `${d.cluster}|${d.pathwayId}`,
        ...d,
        logFdr: toLog10(d.fdr),
      })).sort((a, b) => a.cluster - b.cluster);
    }, [data]);

    const height = rows.length * BAR_HEIGHT + MARGIN.top + MARGIN.bottom;

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
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svgRef.current);
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'enrichment.svg';
        a.click();
        URL.revokeObjectURL(url);
      }
    }));

    return (
      <div className="w-full h-full overflow-y-auto">
      <ParentSize>{({ width }) => {
        const yScale = scaleBand({
          domain: rows.map((d) => d.id),
          range: [MARGIN.top, height - MARGIN.bottom],
          padding: 0.15
        });

        const xScale = scaleLinear({
          domain: [0, Math.max(...rows.map((d) => d.logFdr)) + 0.5],
          range: [MARGIN.left, width - MARGIN.right]
        });

        return (
          <svg ref={svgRef} width={width} height={height}>
            <Group>
              <AxisTop
                top={MARGIN.top}
                scale={xScale}
                numTicks={5}
                tickFormat={(v) => v.toFixed(1)}
                label="-log₁₀(FDR)"
              />
              <AxisBottom
                top={height - MARGIN.bottom}
                scale={xScale}
                numTicks={5}
                tickFormat={(v) => v.toFixed(1)}
                label="-log₁₀(FDR)"
              />
              <AxisLeft
                left={MARGIN.left - 2}
                scale={yScale}
                numTicks={rows.length}
                tickFormat={(id) => {
                  const r = rows.find((x) => x.id === id);
                  return truncate(r?.pathway || '') || '';
                }}
              />

              {/* bars */}
              {rows.map((r) => {
                const y = yScale(r.id);
                if (y === undefined) return null;

                const matchCluster = activeCid !== null && r.cluster === activeCid;
                const matchGene = activeGene !== null && r.genes.includes(activeGene);
                const matchHover = r.cluster === hoverCid;
                const stroke = matchCluster || matchGene || matchHover ? '#000' : 'none';

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
                      onMouseEnter={() => {
                        setHoverCid(r.cluster);
                        onBarHover?.(r);
                      }}
                      onMouseLeave={() => {
                        setHoverCid(null);
                        onBarHover?.(null);
                      }}
                    />
                  </Group>
                );
              })}

              {/* threshold line */}
              <line
                x1={xScale(toLog10(fdrThreshold))}
                x2={xScale(toLog10(fdrThreshold))}
                y1={MARGIN.top}
                y2={height - MARGIN.bottom}
                stroke="grey"
                strokeWidth="2"
                strokeDasharray="3 3"
              />
            </Group>
          </svg>
        );
      }}</ParentSize>
      </div>
    );
  }
);

EnrichmentBarplot.displayName = 'EnrichmentBarplot';
export default EnrichmentBarplot;
