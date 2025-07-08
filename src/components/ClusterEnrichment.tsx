import {
  forwardRef, useCallback, useEffect, useImperativeHandle,
  useMemo, useRef, useState,
} from 'react';
import DynamicContainer from '@/components/DynamicContainer';
import ControlPanel from '@/components/ControlPanel';
import ClusterGraph, {
  ClusterGraphHandle, generatePalette,
} from '@/components/ClusterGraph';
import EnrichmentBarplot, {
  Pathway, EnrichmentBarplotHandle,
} from '@/components/EnrichmentBarplot';
import type { ElementDefinition } from 'cytoscape';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';

/* ---------- fetch helper (POST) -------------------------------------- */
type Filters = {
  confidence: number;
  edgeSources: string[];
  analyses: string[];
  effects: string[];
};

const DEFAULT_EDGE_SOURCES = [
    'neighborhood', 
    'fusion', 
    'phylogenetic', 
    'coexpression', 
    'experimental', 
    'database', 
]

async function fetchData(endpoint: string, filters: Filters) {
  const r = await fetch(endpoint, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(filters),
  });
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return (await r.json()) as {
    nodes      : ElementDefinition[];
    edges      : ElementDefinition[];
    enrichment : Pathway[];
  };
}

/* ---------- palettes -------------------------------------------------- */
const ANALYSIS_PALETTE = {
  Aβ42: '#619878',
  Tau : '#8e8ec1',
  αSyn: '#eeaa58',
};
const EFFECT_PALETTE = {
  Suppressor: '#587ead',
  Driver    : '#ad5d58',
  Enhancer  : '#ad5d58',
  Modifier  : '#5dad58',
  Neutral   : '#888888',
};

function replaceRectsWithPaths(svg: SVGSVGElement) {
  [...svg.querySelectorAll('rect')].forEach(r => {
    const x  = +r.getAttribute('x')! || 0;
    const y  = +r.getAttribute('y')! || 0;
    const w  = +r.getAttribute('width')!  || 0;
    const h  = +r.getAttribute('height')! || 0;

    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M${x},${y}h${w}v${h}h-${w}Z`);
    // copy presentation attributes you care about
    ['fill','stroke','stroke-width','opacity'].forEach(attr => {
      const v = r.getAttribute(attr);
      if (v) p.setAttribute(attr, v);
    });
    r.parentNode!.replaceChild(p, r);
  });
}


/* ---------- handle + props ------------------------------------------- */
export interface ClusterEnrichmentHandle {
  getGenes(): string[];
  selectGenes(ids: string[]): void;
  getPalettes(): Record<string, Record<string | number, string>>;
}

interface Props {
  dataEndpoint: string;
  nodeDetailsEndpoint: (id: string) => string;
  onGenesSelect?: (ids: string[]) => void;
}

const ClusterEnrichment = forwardRef<ClusterEnrichmentHandle, Props>(
  ({ dataEndpoint, nodeDetailsEndpoint, onGenesSelect }, ref) => {
    const graphRef   = useRef<ClusterGraphHandle>(null);
    const barplotRef = useRef<EnrichmentBarplotHandle>(null);

    /* expose handle to parent */
    useImperativeHandle(ref, () => ({
      getGenes: () =>
        graphRef.current?.getCy()?.nodes().map((n) => n.id()) ?? [],
      selectGenes(ids) {
        barplotRef.current?.highlightGene(null);
        graphRef.current?.selectNodes(ids);
      },
      getPalettes: () => ({
        source : ANALYSIS_PALETTE,
        effect : EFFECT_PALETTE,
        cluster: palette,
      }),
    }));

    /* ---------------- data + filter state --------------------------- */
    const [rows,   setRows]   = useState<ElementDefinition[]>([]);
    const [edges,  setEdges]  = useState<ElementDefinition[]>([]);
    const [enrich, setEnrich] = useState<Pathway[]>([]);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState<string | null>(null);

    /* filters come from ControlPanel */
    const [ringKey, setRingKey] = useState<string | undefined>("effect");
    const [filters, setFilters] = useState<Filters>({
      confidence : 0.4,
      edgeSources: DEFAULT_EDGE_SOURCES,
      analyses   : Object.keys(ANALYSIS_PALETTE),
      effects    : ["Suppressor", "Driver"],
    });

    /* utilities (place near other helpers) */
    /* helper: sort + dedupe */
    const canon = (arr: string[]) =>
    Array.from(new Set(arr)).sort();          // ① unique & alphabetical

    /* compare two canonical arrays (both already sorted) */
    const sameArr = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

    /* replace updateFilters */
    const updateFilters = useCallback((f: Filters) => {
    const next: Filters = {
        confidence : f.confidence,
        edgeSources: canon(f.edgeSources),      // ② normalise
        analyses   : canon(f.analyses),         // ②
        effects    : canon(f.effects),          // ②
    };

    setFilters((prev) =>
        prev.confidence === next.confidence &&
        sameArr(prev.edgeSources, next.edgeSources) &&
        sameArr(prev.analyses,    next.analyses) &&
        sameArr(prev.effects,     next.effects)
        ? prev                 // nothing really changed
        : next,                // commit – triggers one fetch
    );
    }, []);

    /* refetch whenever filters change */
    useEffect(() => {
      let cancel = false;
      setLoading(true);
      fetchData(dataEndpoint, filters)
        .then(({ nodes, edges, enrichment }) => {
          if (cancel) return;
          setRows(nodes);
          setEdges(edges);
          setEnrich(enrichment);
          setError(null);
        })
        .catch((e) => !cancel && setError((e as Error).message))
        .finally(() => !cancel && setLoading(false));
      return () => {cancel = true};
    }, [dataEndpoint, filters]);

    const palette = useMemo(
      () => generatePalette(rows, 'cluster'),
      [rows],
    );

  async function exportFigures() {
    const graphSVG = graphRef.current?.getCy()?.svg({ full: false });
    const barplotSVG = barplotRef.current?.getSVG?.() as SVGElement | null;

    if (!graphSVG || !barplotSVG) {
      alert('One of the visualizations is not available for export.');
      return;
    }

    // Combine into PDF
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt' });

    const svgContainer1 = document.createElement('div');
    svgContainer1.innerHTML = graphSVG;
    const svgEl1 = svgContainer1.querySelector('svg');

    replaceRectsWithPaths(barplotSVG);          // 👈 make it safe
    const svgEl2 = barplotSVG.cloneNode(true) as SVGElement;

    if (svgEl1 && svgEl2) {
      await svg2pdf(svgEl1, pdf, {  yOffset: 20 });
      pdf.addPage();
      await svg2pdf(svgEl2, pdf, { xOffset: 20, yOffset: 20 });
      pdf.save('gene-cluster-enrichment.pdf');
    }
  }



    if (error)   return <div className="p-4 text-red-600">{error}</div>;

    /* ------------------- render ------------------------------------ */
    return (
      <div className="h-full flex flex-col gap-2">
        <ControlPanel
          graphRef={graphRef}
          activeRing={ringKey}
          activeEdgeSources={filters.edgeSources}
          onFiltersChange={updateFilters}
          onExportFigures={exportFigures}
          onActiveRingChange={(value) => {
            graphRef.current?.drawRing(
              value === 'none' ? { key: undefined } : { key: value },
            );
            setRingKey(value);
          }}
        />

        {loading && (
            <div className="p-4 text-gray-500">Loading data...</div>
        )}
        {!loading && (
          <div className="flex-grow flex overflow-hidden">
            <DynamicContainer>
              <ClusterGraph
                ref={graphRef}
                nodes={rows}
                edges={edges}
                palette={palette}
                sourcePalette={ANALYSIS_PALETTE}
                effectPalette={EFFECT_PALETTE}
                ringKey={ringKey}
                nodeDetailsEndpoint={nodeDetailsEndpoint}
                /* hover → highlight */
                onNodeMouseEnter={(id) => barplotRef.current?.highlightGene(id)}
                onNodeMouseLeave={()   => barplotRef.current?.highlightGene(null)}
                onNodesSelect={onGenesSelect}
              />

              <EnrichmentBarplot
                ref={barplotRef}
                data={enrich}
                palette={palette}
                onBarHover={(p) => {
                  const g = graphRef.current;
                  if (!g) return;
                  g.highlightCluster(p?.cluster ?? null);
                  g.selectNodes(p?.genes ?? []);
                }}
              />
            </DynamicContainer>
          </div>
        )}

      </div>
    );
  },
);

ClusterEnrichment.displayName = 'ClusterEnrichment';
export default ClusterEnrichment;
