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

  /* -------------------------------------------------------------------------- */
  /* helper: add viewBox if missing & strip fixed dimensions                    */
  function normaliseSvg(svg: SVGSVGElement) {
    // remove width/height attributes – keeps things scalable
    svg.removeAttribute('width');
    svg.removeAttribute('height');

    if (svg.hasAttribute('viewBox')) return; // already good

    // fall back on <svg width="…" height="…"> or a live BBox measurement
    let w = parseFloat(svg.getAttribute('width')  || '');
    let h = parseFloat(svg.getAttribute('height') || '');

    if (!w || !h) {
      // attach off-DOM, measure, detach
      const tmp = document.createElement('div');
      tmp.style.position = 'absolute';
      tmp.style.left = tmp.style.top = '-9999px';
      document.body.appendChild(tmp);
      tmp.appendChild(svg);
      const bb = svg.getBBox();
      w = bb.width;
      h = bb.height;
      tmp.remove();
    }
    if (w && h) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  function createCompositeSvg(
      graphSvg: SVGSVGElement,
      barSvg:   SVGSVGElement,
      gap = 40
    ) {
    const NS = 'http://www.w3.org/2000/svg';

    /* 1 ── pull sizes straight from viewBox */
    const gVB = graphSvg.viewBox.baseVal;
    const bVB = barSvg.viewBox.baseVal;

    const gW = gVB.width,  gH = gVB.height;
    const bW = bVB.width,  bH = bVB.height;

    const width = gW + gap + bW
    const height = Math.max(gH, bH) + 10; // small margin

    /* 2 ── wrap each panel so we can shift them without touching internals */
    const gWrap = document.createElementNS(NS, 'g');
    gWrap.setAttribute('transform', `translate(${-gVB.x} ${-gVB.y})`);
    graphSvg.removeAttribute("viewBox");
    gWrap.appendChild(graphSvg);
    console.log(bVB)
    console.log(gVB)

    const bWrap = document.createElementNS(NS, 'g');
    bWrap.setAttribute(
      'transform',
      `translate(${gVB.x + gW + gap} 0)`,
    );
    barSvg.removeAttribute("viewBox")
    bWrap.appendChild(barSvg);

    /* 3 ── root svg */
    console.log(width, height)
    const root = document.createElementNS(NS, 'svg');
    root.setAttribute('xmlns', NS);
    root.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    root.setAttribute('width',  String(width));
    root.setAttribute('height', String(height));
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);

    root.appendChild(gWrap);
    root.appendChild(bWrap);
    return root;
  }

  async function exportFigures() {
    /* 1 ── collect */
    const cy        = graphRef.current?.getCy?.();
    const graphHTML = cy?.svg({ full: true, scale: 0.5 });
    const barSvgEl  = barplotRef.current?.getSVG?.()?.cloneNode(true);

    if (!graphHTML || !barSvgEl) {
      alert('Graph or bar-plot not ready – aborting export.');
      return;
    }

    /* 2 ── to elements */
    const graphSvg = new DOMParser()
      .parseFromString(graphHTML, 'image/svg+xml')
      .documentElement as SVGSVGElement;

    const barSvg = barSvgEl as SVGSVGElement;

    /* 3 ── normalise */
    [graphSvg, barSvg].forEach(normaliseSvg);

    /* 4 ── compose */
    const composite = createCompositeSvg(graphSvg, barSvg);

    /* 5 ── download */
    const out  = new XMLSerializer().serializeToString(composite);
    const blob = new Blob([out], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);

    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: 'gene-cluster-enrichment.svg',
    });
    a.click();
    URL.revokeObjectURL(url);
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
