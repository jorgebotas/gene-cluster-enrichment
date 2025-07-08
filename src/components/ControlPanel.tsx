/* ControlPanel.tsx  –  compact dropdown filters & debounced slider
   ----------------------------------------------------------------
   • Fit / Reset buttons
   • Outer-ring selector (Source / Effect / None)
   • Confidence *slider* now debounced → update on mouse-up / touch-end
   • Edge-source *dropdown* (multi-select check-list)
   • Analysis pills remain
*/

import React, { useEffect, useState } from 'react';
import type { ClusterGraphHandle } from '@/components/ClusterGraph';


/* ───────── props ───────── */
interface Props {
  graphRef: React.RefObject<ClusterGraphHandle>;
  activeRing?: string;
  activeEdgeSources?: string[];
  onFiltersChange?: (p: {
    confidence: number;
    edgeSources: string[];
    analyses: string[];
  }) => void;
  onActiveRingChange?: (ring: string) => void;
  onExportFigures?: () => void;
}

/* default ring menu */
const ANALYSIS_PALETTE = {
  Aβ42: '#619878',
  Tau : '#8e8ec1',
  αSyn: '#eeaa58',
};
const EFFECT_PALETTE = {
  Suppressor: '#587ead',
  Driver    : '#ad5d58',
};
const RING_OPTIONS = [
  { label: 'Analysis', value: 'source' },
  { label: 'Effect', value: 'effect' },
  { label: 'None',   value: 'none'   },
];
const EDGE_SOURCES = [
    {label: "Neighborhood", value: 'neighborhood'},
    {label: "Fusion", value: 'fusion'},
    {label: "Phylogenetic", value: 'phylogenetic'},
    {label: "Coexpression", value: 'coexpression'},
    {label: "Experimental", value: 'experimental'},
    {label: "Database", value: 'database'},
    {label: "Text Mining", value: 'textmining'},
]


/* quick Tailwind snippets */
const btn   = 'rounded-md text-sm font-medium px-3 py-1 transition ' +
              'bg-indigo-100 hover:bg-indigo-200';
const pill  = 'px-3 py-1 rounded text-sm transition cursor-pointer';

/* ------------------------------------------------------------------ */
export default function ControlPanel({
  graphRef,
  activeRing,
  activeEdgeSources,
  onFiltersChange,
  onActiveRingChange,
  onExportFigures,
}: Props) {
  /* local UI state */
  const [ringKey,  setRingKey]  = useState(activeRing || "none");
  const [conf,     setConf]     = useState(0.4); // committed value
  const [tempConf, setTemp]     = useState(0.4); // slider position
  const [sources,  setSources]  = useState<Set<string>>(new Set(
    activeEdgeSources || EDGE_SOURCES.map((s) => s.value),
  ));
  const [analyses, setAnalyses] = useState<Set<string>>(new Set(
    Object.keys(ANALYSIS_PALETTE)
  ));
  const [effects,  setEffects]  = useState<Set<string>>(new Set(
    Object.keys(EFFECT_PALETTE)
  ));

  /* helpers */
  const toggle =
    <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, key: T) =>
      set((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
      });

  /* push filters to graph */
  useEffect(() => {
    const filters = {
      confidence: conf,
      edgeSources: Array.from(sources),
      analyses: Array.from(analyses),
      effects: Array.from(effects),
    };
    console.log("calling onFiltersChange", filters);
    onFiltersChange?.(filters);
  }, [conf, sources, analyses, effects, onFiltersChange]);

  /* ------------------------------------------------------------------ */
  return (
    <div className="flex flex-wrap items-center gap-4 p-3 m-3 bg-white
                    rounded-xl shadow-lg">

      {/* reset / fit */}
      <button className={btn}
              onClick={() => graphRef.current?.rebuildGraph()}>
        Reset View
      </button>
      <button className={btn}
              onClick={() => onExportFigures()}>
        Export
      </button>
      {/* <button className={btn}
              onClick={() => graphRef.current?.getCy()?.fit()}>
        Fit
      </button> */}

      {/* analysis pills */}
      <div className="flex items-center gap-1">
        <label className="text-sm font-medium pr-3">Analysis:</label>

        {Object.entries(ANALYSIS_PALETTE).map(([a, color]) => (
          <span
            key={a}
            onClick={() => toggle(setAnalyses, a)}
            className={`${pill}
              ${analyses.has(a) ? 'text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
            style={{
              backgroundColor: analyses.has(a) && color
            }}
          >
            {a}
          </span>
        ))}

      </div>

      <div className="flex items-center gap-1">
        <label className="text-sm font-medium pr-3">Effect:</label>
        {Object.entries(EFFECT_PALETTE).map(([e, color]) => (
          <span
            key={e}
            onClick={() => toggle(setEffects, e)}
            className={`${pill}
              ${effects.has(e) ? 'text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
            style={{
              backgroundColor: effects.has(e) && color
            }}
          >
            {e}
          </span>
        ))}
      </div>


      {/* ring selector */}
      <label className="text-sm font-medium">Outer ring:</label>
      <div className="inline-flex rounded-md bg-gray-200 overflow-hidden">
        {RING_OPTIONS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => {
              setRingKey(value);
              graphRef.current?.drawRing(
                value === 'none' ? { key: undefined } : { key: value },
              );
              onActiveRingChange?.(value);
            }}
            className={`px-3 py-1 text-sm transition
              ${ringKey === value
                ? 'bg-indigo-500 text-white'
                : 'text-gray-700 hover:bg-gray-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* confidence slider – debounce commit */}
      <label className="text-sm font-medium">
        Edge confidence&nbsp;≥&nbsp;{tempConf.toFixed(1)}
      </label>
      <input
        type="range"
        min={0.1}
        max={0.9}
        step={0.1}
        value={tempConf}
        onChange={(e) => setTemp(parseFloat(e.target.value))}
        onMouseUp={() => setConf(tempConf)}
        // onTouchEnd={() => setConf(tempConf)}
        className="accent-indigo-500 w-36"
      />

      {/* edge-source dropdown */}
      <details className="relative">
        <summary
          className="cursor-pointer px-3 py-1 bg-gray-200 rounded
                     text-sm hover:bg-gray-300 select-none"
        >
          Edge sources
        </summary>

        <div
          className="absolute z-10 mt-1 bg-white border rounded shadow
                     p-2 flex flex-col gap-1"
        >
          {EDGE_SOURCES.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={sources.has(s.value)}
                onChange={() => toggle(setSources, s.value)}
              />
              {s.label}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
