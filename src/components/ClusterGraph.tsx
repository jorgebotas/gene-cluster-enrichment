// ClusterGraph.tsx — cleaned & consolidated
// ---------------------------------------------------------------------------
//  A React wrapper around Cytoscape that supports:
//   • CiSE layout with cluster colouring
//   • shared palette + imperative highlighting API
//   • hover & click selection with pop‑over details
//   • optional ring‑pie annotation on node border via `data.source: string[]`
// ---------------------------------------------------------------------------
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import cytoscape, {
  Core,
  ElementDefinition,
  EventObject,
  Stylesheet,
  NodeSingular,
} from 'cytoscape';
import cise from 'cytoscape-cise';
import layoutUtilities from 'cytoscape-layout-utilities';
import cytoscapePopper from 'cytoscape-popper';
import svg from 'cytoscape-svg';
import { computePosition, flip, shift, limitShift } from '@floating-ui/dom';

// ---------------------------------------------------------------------------
// • Public contracts
// ---------------------------------------------------------------------------
export interface ClusterGraphHandle {
  highlightCluster: (cid: number | null) => void;
  selectNode: (id: string | null) => void;
  selectNodes: (ids: string[]) => void;
  getPalettes: () => Record<string, Record<string | number, string>>;
  setPalette: (p: Record<number, string>) => void;
  drawRing: ({key, palette}: {key?: string, palette?: Record<string, string>}) => void;
  getCy: () => Core | null;
  getCounts: () => Record<string, number>,
  rebuildGraph: () => void;
}

export interface ClusterGraphProps {
  // Data
  dataEndpoint?: string;
  nodes?: ElementDefinition[];
  edges?: ElementDefinition[];

  // Styling / palettes
  palette?: Record<number, string>;              // cluster → colour
  sourcePalette?: Record<string, string>;        // source tag → colour
  effectPalette?: Record<string, string>;         // effect tag → colour

  ringKey?: string;                     // whether to draw ring‑pie on node border

  // Callbacks
  nodeDetailsEndpoint?: (id: string) => string;
  onNodesSelect?: (ids: string[]) => void;
  onNodeMouseEnter?: (id: string, cid: number) => void;
  onNodeMouseLeave?: (id: string, cid: number) => void;
  onClusterSelect?: (cid: number) => void;

  // Layout / style tweak hooks
  layoutOptions?: Partial<CiseLayoutOptions>;
  showInterClusterEdges?: boolean;
  additionalStyles?: Stylesheet[];
}

// ---------------------------------------------------------------------------
// • Internal helpers / constants
// ---------------------------------------------------------------------------
interface GeneNodeData {
  id: string;
  name: string;
  cluster: number;
  source?: string[]; // provenance tags for ring‑pie
  effect?: string[]; // provenance tags for ring‑pie
}

interface NodeDetails {
  description: string;
  link: string;
}

interface CiseLayoutOptions {
  name: 'cise';
  clusters: string[][];
  [k: string]: unknown;
}

const DEFAULT_LAYOUT: CiseLayoutOptions = {
  name: 'cise',
  clusters: [],
  randomize: true,
  animate: false,
  refresh: 10,
  padding: 10,
  nodeSeparation: 5,
  packComponents: true,
  allowNodesInsideCircle: false,
  maxRatioOfNodesInsideCircle: 0.3,
};

const DEFAULT_LAYOUT_UTILITIES = {
  componentSpacing: 70,
  desiredAspectRatio: 1,
  utilityFunction: 1,
  polyominoGridSizeFactor: 1,
};

const NODE_STYLE: Stylesheet = {
  selector: 'node',
  style: {
    width: 40,
    height: 40,
    label: 'data(name)',
    'font-size': 10,
    'text-valign': 'center',
    'text-halign': 'center',
    'border-width': 0,
    'border-color': '#A0AEC0',
    'transition-property': 'border-width, border-color, opacity',
    'transition-duration': '0.15s',
    'overlay-opacity': 0,
    'pie-size': '100%', // enable pie API
    'pie-hole': '80%', // hollow center
  },
};
const EDGE_STYLE: Stylesheet = {
  selector: 'edge',
  style: { width: 1, 'line-color': '#A0AEC0', events: 'no', 'curve-style': 'bezier' },
};
const NODE_SELECTED: Stylesheet = {
  selector: 'node:selected',
  style: { 'border-width': 5, 'border-color': '#000', 'font-weight': 'bold' },
};
const NODE_HOVER: Stylesheet = {
  selector: 'node.hovered',
  style: { 'border-width': 5, 'border-color': '#000', 'font-weight': 'bold' },
};
const NODE_DIM: Stylesheet = {
  selector: 'node.dimmed',
  style: { 'opacity': 0.5 },
};
const EDGE_ACTIVE_KILL: Stylesheet = {
  selector: 'edge:active',
  style: { 'overlay-opacity': 0, width: 1 },
};


export const generatePalette = (
  nodes: ElementDefinition[],
  key: string,
): Record<string | number, string> => {
  /* Collect unique ids; expand arrays/iterables */
  const idSet = new Set<unknown>();

  nodes.forEach((n) => {
    const val = (n.data as any)[key];
    if (val == null) return;
    if (Array.isArray(val) || typeof val?.[Symbol.iterator] === 'function') {
      for (const item of val as Iterable<unknown>) idSet.add(item);
    } else {
      idSet.add(val);
    }
  });

  const ids = Array.from(idSet);
  /* Sort so colour assignment is stable */
  ids.sort((a, b) => `${a}`.localeCompare(`${b}`));

  const step = ids.length ? 360 / ids.length : 1;

  return Object.fromEntries(
    ids.map((id, i) => [id, `hsl(${Math.round(i * step)},70%,80%)`]),
  );
};


const popperFactory = (ref: any, content: HTMLElement) => {
  const opts = { middleware: [flip(), shift({ limiter: limitShift() })] };
  const inst = {
    update: () =>
      computePosition(ref, content, opts).then(({ x, y }) => {
        Object.assign(content.style, { position: 'fixed', left: `${x}px`, top: `${y}px` });
      }),
    destroy: () => (content.style.display = 'none'),
  };
  inst.update();
  return inst;
};

const fetchGraph = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`graph fetch ${r.status}`);
  return (await r.json()) as { nodes: ElementDefinition[]; edges: ElementDefinition[] };
};
const fetchDetails = async (url: string): Promise<NodeDetails> => {
  const r = await fetch(url);
  return r.ok ? ((await r.json()) as NodeDetails) : { description: 'N/A', link: '#' };
};



// ---------------------------------------------------------------------------
// • Component
// ---------------------------------------------------------------------------
const ClusterGraph = forwardRef<ClusterGraphHandle, ClusterGraphProps>((props, ref) => {
  const {
    dataEndpoint,
    nodes: propNodes,
    edges: propEdges,
    palette: propPalette,
    ringKey,
    sourcePalette,
    effectPalette,
    nodeDetailsEndpoint = (id) => `/api/node-details/${id}`,
    layoutOptions,
    onNodesSelect,
    onNodeMouseEnter,
    onNodeMouseLeave,
    onClusterSelect,
    showInterClusterEdges = true,
    additionalStyles = [],
  } = props;

  // ---- cytoscape setup
  cytoscape.use(cise);
  cytoscape.use(svg);
  cytoscape.use(layoutUtilities);
  cytoscape.use(cytoscapePopper(popperFactory));


  // ---- refs / state
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const detachFitRef = useRef<(() => void) | null>(null);
  const graphRef = useRef<{
    nodes: ElementDefinition[];
    edges: ElementDefinition[];
    clusters: string[][];
  } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const paletteRef = useRef<Record<number, string>>(propPalette ?? {});
  const ringRef = useRef<string>(ringKey);
  const ringPaletteRef = useRef<
    Record<string, Record<string | number, string>>
  >({
    "source": sourcePalette ?? {},
    "effect": effectPalette ?? {},
  });
  const [counts, setCounts] = useState<Record<string, number>>({})

  // Internal event handlers
  async function onNodeTap({event, cy}: {event: EventObject, cy: Core}) {
    const n = event.target as NodeSingular;
    const id = n.id();
    const cid = n.data('cluster') as number;
    cy.nodes().forEach((n) => n.scratch('_popper')?.destroy?.());
    cy.nodes().unselect();
    n.select();
    onNodesSelect?.([id]);
    // <div class="flex flex-wrap gap-1">
    // <span class="inline-block px-2 py-1 text-xs rounded-sm" 
    //  style="background:${ paletteRef.current[cid]}">Cluster: ${cid}</span>
    // </div>

    const det = await fetchDetails(nodeDetailsEndpoint(id));
    if (!popRef.current) return;
    popRef.current.innerHTML = `
      <h4 class="font-semibold">${n.data('name')}</h4>
      <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-sm" 
        style="background:${paletteRef.current[cid]}"></span>
        Cluster ${cid}
      </div>
      <div class="flex flex-wrap gap-1">
        ${n.data('source')?.map((tag: string) => `
          <span class="inline-block px-2 py-1 text-xs rounded-sm" 
          style="background:${ringPaletteRef.current["source"][tag] ?? '#999'}; color: #fff;">
            ${tag}
          </span>
        `).join('') ?? ''}
      </div>
      <div class="flex flex-wrap gap-1">
        ${n.data('effect')?.map((tag: string) => `
          <span class="inline-block px-2 py-1 text-xs rounded-sm" 
          style="background:${ringPaletteRef.current["effect"][tag] ?? '#999'}; color: #fff;">
            ${tag}
          </span>
        `).join('') ?? ''}
      </div>
      <p>${det.description}</p>
      <a class="text-indigo-600 underline" href="${det.link}" target="_blank">Details</a>
    `;
    popRef.current.style.display = 'block';
    const popper = n.popper({ content: () => popRef.current! });
    n.scratch('_popper', popper);

    // Sticky popover
    let update = () => popper.update();
    n.on('position', update);
    cy.on('pan zoom resize', update);
  }

  // ---- helpers ----------------------------------------------------
  // Apply cluster palette to nodes
  function applyClusterPalette() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const cid = n.data('cluster') as number;
        n.style('background-color', paletteRef.current[cid] ?? '#ccc');
      });
    });
  }

  // Draw ring‑pie on node border
  // If `ringRef` is not set, remove pie styles from all nodes
  // If `ringRef` is set, apply pie styles based on the selected key
  function drawRing() {
    const cy = cyRef.current;
    if (!cy) return;
    // Remove existing pie styles if ringRef is not set
    const key = ringRef.current;
    if (!key) {
      cy.nodes().style("pie-size", '0%');
      return;
    } else cy.nodes().style("pie-size", '100%');
    const palette = ringPaletteRef.current[key] ?? {};
    cy.batch(() => {
      cy.nodes().forEach((n) => {
        const src = (n.data(key) as string[] | undefined) ?? [];
        if (!src.length) return;
        const slice = 100 / src.length;
        src.forEach((tag, idx) => {
          n.style(`pie-${idx + 1}-background-color`, palette[tag] ?? '#999');
          n.style(`pie-${idx + 1}-background-size`, `${slice}%`);
        });
      });
    });
  }

  function applyLayout() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.layoutUtilities({
      ...DEFAULT_LAYOUT_UTILITIES,
      desiredAspectRatio : cy.width() / cy.height(), //  >1 = landscape
    });
    cy.layout({ 
      ...DEFAULT_LAYOUT, 
      ...layoutOptions, 
      clusters: graphRef!.current!.clusters! 
    } as CiseLayoutOptions).run();
    cy.fit(undefined, 20); // fit with 20px padding
  }

  // Attach a resize observer to the container element and fit the graph
  const attachFitOnResize = (cy: Core, el: HTMLElement) => {
    let t: number | undefined;          // last timer id

    const lazyFit = () => {
      clearTimeout(t);
      t = window.setTimeout(() => cy.fit(undefined, 20), 180); // 180-ms lull
    };

    const ro = new ResizeObserver(lazyFit);
    ro.observe(el);

    window.addEventListener('resize', lazyFit);
    lazyFit();                          // initial fit

    /* return a cleanup fn */
    return () => {
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener('resize', lazyFit);
    };
  };


  // ---------------------------------------------------------------------------
  // • Cytoscape initalization
  function initGraph(): {cy: Core, detachFit: () => void} {
    // Build hidden popover once
    if (!popRef.current) {
      popRef.current = document.createElement('div');
      popRef.current.className =
        'absolute z-50 bg-white rounded-md shadow-lg p-4 text-sm space-y-2 max-w-[320px]';
      popRef.current.style.display = 'none';
      document.body.appendChild(popRef.current);
    }

    if (!graphRef.current) throw new Error('empty graph');

    const {nodes, edges, clusters} = graphRef.current

    if (!nodes.length) throw new Error('empty graph');

    if (!Object.keys(paletteRef.current).length) 
      paletteRef.current = generatePalette(nodes, "cluster");

    Object.keys(ringPaletteRef.current).forEach((key) => {
      if (!Object.keys(ringPaletteRef.current[key]).length) {
        ringPaletteRef.current[key] = generatePalette(nodes, key);
      }
    });

    // Separate intra- and inter-cluster edges
    // Intra-cluster edges are those that connect nodes within the same cluster
    // Inter-cluster edges are those that connect nodes from different clusters
    // Layout is applied only to intra-cluster edges
    // Inter-cluster edges are added later if `showInterClusterEdges` is true
    const intra = edges.filter((e) => e.data.intra);
    const inter = edges.filter((e) => !e.data.intra);

    const cy = (cyRef.current = cytoscape({
      container: containerRef.current!,
      elements: [...nodes, ...intra],
      style: [
        NODE_STYLE, 
        EDGE_STYLE, 
        NODE_SELECTED, 
        NODE_HOVER, 
        NODE_DIM,
        EDGE_ACTIVE_KILL, 
        ...additionalStyles
      ],
      layout: { name: 'preset' },
    })) as Core;

    // CiSE clusters
    if (!clusters || !clusters.length) {
      const clusters: string[][] = [];
      const map = new Map<number, string[]>();
      cy.nodes().forEach((n) => {
        const cid = n.data('cluster') as number;
        (map.get(cid) ?? map.set(cid, []).get(cid)!).push(n.id());
      });
      map.forEach((ids) => clusters.push(ids));
      graphRef.current!.clusters = clusters;
    }

    // Fit graph container size and pack componentes (layoutUtilities)
    applyLayout();

    if (showInterClusterEdges && inter.length) {
      cy.add(inter.map((e) => ({ ...e, classes: 'inter' })));
      cy.style().selector('edge.inter').style({ width: 1, opacity: 0.7 }).update();
    }

    applyClusterPalette();
    drawRing();

    // -------------------------------------------------------------------------
    // Event handlers
    // Hover behaviour
    cy.on('mouseover', 'node', (e) => {
      const n = e.target as NodeSingular;
      if (!n.selected()) n.addClass('hovered');
      onNodeMouseEnter?.(n.id(), n.data('cluster') as number);
    });
    cy.on('mouseout', 'node', (e) => {
      const n = e.target as NodeSingular;
      n.removeClass('hovered');
      onNodeMouseLeave?.(n.id(), n.data('cluster') as number);
    });

    // Tap behaviour
    cy.on('tap', 'node', async (event: EventObject) => {
      onNodeTap({event, cy});
    });

    cy.on('tap', (e) => {
      if (e.target === cy) {
        cy.nodes().forEach((n) => n.scratch('_popper')?.destroy?.());
        cy.nodes().unselect();
        onNodesSelect?.([]);
      }
    });

    // Box selection
    cy.on('boxselect', (e) => {
      const selectedNodes = cy.nodes(':selected');
      if (selectedNodes.length === 0) return;
      const ids = selectedNodes.map((n) => n.id());
      onNodesSelect?.(ids);
    })

    cy.edges().unselectify();

    setCounts({
      nodes: graphRef.current.nodes.length, 
      edges: graphRef.current.edges.length, 
      clusters: graphRef.current.clusters.length
    });

    /* ───────────────────────── fit on resize ────────────────────────── */
    const detachFit = attachFitOnResize(cy, containerRef.current!);
    
    return { cy, detachFit };
  };

  // ---- imperative API --------------------------------------------
  useImperativeHandle(ref, () => ({
    highlightCluster(cid) {
      const cy = cyRef.current;
      if (!cy) return;
      cy.batch(() => {
        cy.nodes().unselect();
        cy.nodes().removeClass('hovered');
        if (cid === null)
          cy.nodes().removeClass('dimmed');
        else {
            cy.nodes().addClass('dimmed');
            cy.nodes(`[cluster = ${cid}]`).removeClass('dimmed');
        }
        // if (cid !== null) cy.nodes(`[cluster = ${cid}]`).select();
      });
    },
    selectNode(id) {
      const cy = cyRef.current;
      if (!cy) return;
      cy.nodes().unselect();
      if (id) cy.$(`#${id}`).select();
    },
    selectNodes(ids: string[]) {
      const cy = cyRef.current;
      if (!cy) return;
      cy.nodes().unselect();
      if (ids.length) cy.batch(() => cy.$(`#${ids.join(', #')}`).select());
    },
    getPalettes() {
      return {
        cluster: paletteRef.current,
        ...ringPaletteRef.current,
      };
    },
    setPalette(p) {
      paletteRef.current = p;
      applyClusterPalette();
    },
    drawRing({
        key, 
        palette
      }: { 
        key?: string; 
        palette?: Record<string, string> 
      } = {}) {
        ringRef.current = key;
        if (key && palette)
          ringPaletteRef.current[key] = palette;
        else if (key && !palette && !ringPaletteRef.current[key])
          ringPaletteRef.current[key] = generatePalette(graphRef.current?.nodes!, key);

        // Call drawRing to apply the changes
        drawRing();
    },
    getCy() {
      return cyRef.current;
    },
    getCounts() {
      const graph = graphRef.current;
      if (!graph) return {};
      return {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        clusters: graph.clusters.length
      }
    },
    rebuildGraph() {
      // clean previous instance
      detachFitRef.current?.();
      cyRef.current?.destroy();

      // re-initialise with latest props / palettes
      const { cy, detachFit } = initGraph();
      cyRef.current = cy;
      detachFitRef.current = detachFit;
    }
  }));


  // ---- bootstrap --------------------------------------------------
  useEffect(() => {
    if (!containerRef.current) return;

    (async () => {
      let nodes = propNodes ?? [];
      let edges = propEdges ?? [];
      if (!nodes.length || !edges.length) {
        if (!dataEndpoint) throw new Error('no data');
        ({nodes, edges} = await fetchGraph(dataEndpoint));
      }
      graphRef.current = { nodes, edges };
    })().catch((err) => console.error('[ClusterGraph] init', err));

    const {cy, detachFit} = initGraph()
    cyRef.current = cy;
    detachFitRef.current = detachFit;

    return () => {
      detachFitRef.current?.();
      cyRef.current?.destroy();
    };
  }, []);

  return (
    <div className="relative w-full h-full">
    {counts.nodes && (
      <div className="absolute top-0 left-10 text-xs ">
      <span className="mr-1">{counts.nodes} nodes,</span>
      <span className="mr-1">{counts.edges} edges,</span> 
     <span className="mr-1"> {counts.clusters} clusters</span>
      </div>)
    }
    <div ref={containerRef} className="w-full h-full"/>
    </div>
  );
});

ClusterGraph.displayName = 'ClusterGraph';
export default ClusterGraph;
