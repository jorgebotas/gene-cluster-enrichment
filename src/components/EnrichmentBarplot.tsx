// EnrichmentBarplot.tsx — with imperative handle
// ---------------------------------------------------------------------------
// Adds a ref API so parent can:
//   • highlight all bars for a cluster   → highlightCluster(cid)
//   • highlight bars containing a gene   → highlightGene(geneId)
// Pathway rows now accept `genes: string[]`.
// ---------------------------------------------------------------------------

import React, {
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
  ReferenceLine,
} from 'recharts';

/* ------------------------- types ---------------------------------------- */
export interface Pathway {
  cluster: number;      // cluster id
  pathway: string;      // pathway name (can repeat across clusters)
  pathwayId: string;    // pathway identifier
  source: string;       // e.g. KEGG / Reactome
  fdr: number;          // raw FDR (0–1)
  genes: string[];      // genes contributing to enrichment
}

interface Props {
  data: Pathway[];
  palette: Record<number, string>;
  onBarHover?: (pathway: Pathway | null) => void;
  fdrThreshold?: number;
}

export interface EnrichmentBarplotHandle {
  highlightCluster(cid: number | null): void;
  highlightGene(geneId: string | null): void;
}

/* ------------------------- helpers -------------------------------------- */
const toLog10 = (f: number) => -Math.log10(f);
const tickFmt = (n: number) => n.toFixed(1);
const MAX_LABEL = 50;
const truncate = (s: string) =>
  s.length > MAX_LABEL ? s.slice(0, MAX_LABEL - 1) + '…' : s;

/* ------------------------- component ------------------------------------ */
const EnrichmentBarplot = forwardRef<EnrichmentBarplotHandle, Props>(
  (
    {
      data,
      palette,
      onBarHover,
      fdrThreshold = 0.05,
    },
    ref,
  ) => {
    const [hoverCid, setHoverCid] = useState<number | null>(null);
    const [activeCid, setActiveCid] = useState<number | null>(null);
    const [activeGene, setActiveGene] = useState<string | null>(null);

    /* build rows – one per cluster/pathway */
    const rows = useMemo(() => {
      return data.map((d) => ({
        id: `${d.cluster}|${d.pathwayId}`,
        ...d,
        logFdr: toLog10(d.fdr),
      }));
    }, [data]);

    /* imperative API */
    useImperativeHandle(ref, () => ({
      highlightCluster(cid) {
        setActiveGene(null);
        setActiveCid(cid);
      },
      highlightGene(g) {
        setActiveCid(null);
        setActiveGene(g);
      },
    }));

    /* y‑axis tick renderer */
    const yTick = (props: any) => {
      const { x, y, payload } = props;
      const short = truncate(payload.value as string);
      return (
        <text
          x={x}
          y={y}
          dy={4}
          textAnchor="end"
          fill="#333"
          fontSize={12}
          pointerEvents="none"
        >
          {short}
          <title>{payload.value}</title>
        </text>
      );
    };

    /* tooltip */
    const tip = ({ active, payload }: any) => {
      if (!active || !payload?.length) return null;
      const r = payload[0].payload;
      return (
        <div className="rounded border bg-white p-2 text-xs space-y-1">
          <div className="font-semibold max-w-[240px]">
            {r.pathway}
          </div>
          <div>ID: {r.pathwayId}</div>
          <div>Source: {r.source}</div>
          {/* <div>Genes: {r.genes.join(', ')}</div> */}
          <div className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-3 rounded"
              style={{ background: palette[r.cluster] }}
            />
            Cluster {r.cluster}
          </div>
          <div>FDR ≈ {r.fdr.toExponential(2)}</div>
          <div>-log₁₀(FDR): {r.logFdr.toFixed(2)}</div>
        </div>
      );
    };

    /* decide stroke */
    const strokeFor = (row: typeof rows[number]) => {
      const cMatch = activeCid !== null && row.cluster === activeCid;
      const gMatch = activeGene !== null && row.genes.includes(activeGene);
      const hMatch = row.cluster === hoverCid;
      return cMatch || gMatch || hMatch ? '#000' : 'none';
    };

    const minHeight = Math.max(50, rows.length * 15);

    return (
      <ResponsiveContainer 
            width="100%" 
            height="100%" 
            // minHeight={minHeight}
            style={{ overflowY: "auto"}}>
        <BarChart
          data={rows}
          layout="vertical"
          barCategoryGap={2}
          margin={{ left: 240, right: 32, top: 16, bottom: 16 }}
        >
          <XAxis
            type="number"
            tickFormatter={tickFmt}
            domain={[0, 'dataMax + 0.5']}
            label={{ value: '-log10(FDR)', position: 'insideBottom', dy: 12 }}
          />

          <YAxis
            dataKey="pathway"
            type="category"
            width={100}
            interval={0}
            tickLine={false}
            axisLine={false}
            allowDuplicatedCategory
            tick={yTick}
          />

          <Tooltip wrapperStyle={{ zIndex: 1000 }} content={tip} />

          <Bar dataKey="logFdr" isAnimationActive={false}>
            {rows.map((r) => (
              <Cell
                key={r.id}
                fill={palette[r.cluster] ?? '#999'}
                stroke={strokeFor(r)}
                strokeWidth={strokeFor(r) !== 'none' ? 2 : 1}
                onMouseEnter={() => {
                  setHoverCid(r.cluster);
                  onBarHover?.({cluster: r.cluster, genes: r.genes});
                }}
                onMouseLeave={() => {
                  setHoverCid(null);
                  onBarHover?.(null);
                }}
              />
            ))}
          </Bar>

          <ReferenceLine
            x={toLog10(fdrThreshold)}
            strokeDasharray="3 3"
            stroke="grey"
          />
        </BarChart>
      </ResponsiveContainer>
    );
  },
);

EnrichmentBarplot.displayName = 'EnrichmentBarplot';
export default EnrichmentBarplot;
