// GeneTable.tsx — sortable & source‑filterable
// ---------------------------------------------------------------------------
// • Client‑side filtering ( ≤ 500 genes )
// • Sort by: cluster ▴/▾, gene, #orthologs, max‑score
// • Source columns act as checkboxes; multiple → intersection filter
// • Hover/click → onGenesSelect
// ---------------------------------------------------------------------------
import React, {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';

/* -------------------------------- types ------------------------------- */
export interface GeneRecord {
  id: string;
  name: string;
  cluster: number;
  description: string;
  sources: Record<
    'Aβ42' | 'Tau' | 'αSyn',
    {
      effect: 'Suppressor' | 'Enhancer' | 'Modifier' | 'Neutral';
      alleles: {
        Suppressor: number;
        Enhancer: number;
        Modifier: number;
        Neutral: number;
      };
    }
  >;
  orthologs: { symbol: string; score: number }[];
}

interface Props {
  endpoint: string; // returns GeneRecord[]
  palettes: Record<string, Record<string | number, string>>;
  onGenesSelect?: (ids: string[]) => void;
}

export interface GeneTableHandle {
  selectGenes(ids: string[] | null): void;
}

/* -------------------------------- utils ------------------------------- */
const Tag = ({ c, t }: { c: string; t: string | number }) => (
  <span
    className="inline-block w-full text-center text-[11px] text-white"
    style={{ background: c }}
  >
    {t}
  </span>
);

/* -------------------------------- table ------------------------------- */
const GeneTable = forwardRef<GeneTableHandle, Props>(
  ({ endpoint, palettes, onGenesSelect }, ref) => {
    /* full dataset */
    const [rows, setRows] = useState<GeneRecord[]>([]);

    /* UI state */
    const [visibleIds, setVisibleIds] = useState<Set<string> | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [sortKey, setSortKey] = useState<
      'cluster' | 'gene' | 'ortho' | 'score'
    >('cluster');
    const [sortAsc, setSortAsc] = useState(true);
    const [srcFilter, setSrcFilter] = useState<Set<'Aβ42' | 'Tau' | 'αSyn'>>(
      new Set(),
    );

    /* ------------------------------------------------------------------ */
    useEffect(() => {
      fetch(endpoint)
        .then((r) => r.json())
        .then((d: GeneRecord[]) => setRows(d))
        .catch((e) => console.error('gene fetch', e));
    }, [endpoint]);

    /* imperative handle */
    useImperativeHandle(ref, () => ({
      selectGenes(ids) {
        setVisibleIds(ids?.length ? new Set(ids) : null);
        setSelected(new Set(ids ?? []));
      },
    }));

    /* notify parent */
    const emit = (sel: Set<string>) =>
      onGenesSelect?.(sel.size ? Array.from(sel) : []);

    /* toggle select */
    const toggleRow = (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        emit(next);
        return next;
      });
    };

    /* toggle source filter */
    const toggleSrc = (s: 'Aβ42' | 'Tau' | 'αSyn') => {
      setSrcFilter((prev) => {
        const next = new Set(prev);
        next.has(s) ? next.delete(s) : next.add(s);
        return next;
      });
    };

    /* ------------------------------------------------------------------ */
    const filtered = rows.filter((r) => {
      if (visibleIds && !visibleIds.has(r.id)) return false;
      if (!srcFilter.size) return true;
      // keep row only if it has *all* active sources
      return Array.from(srcFilter).every((k) => r.sources[k]);
    });

    const sorted = [...filtered].sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      switch (sortKey) {
        case 'cluster':
          return (a.cluster - b.cluster) * dir;
        case 'gene':
          return a.name.localeCompare(b.name) * dir;
        case 'ortho':
          return (a.orthologs?.length - b.orthologs?.length) * dir;
        case 'score':
          const sA = Math.max(...a.orthologs.map((o) => o.score), 0);
          const sB = Math.max(...b.orthologs.map((o) => o.score), 0);
          return (sA - sB) * dir;
      }
    });

    /* helper components */
    const AlleleBar = ({ a }: { a: Record<string, number> }) => (
      <div className="grid grid-cols-4 gap-[1px] w-28">
        {['Enhancer', 'Suppressor', 'Modifier', 'Neutral'].map((k) => (
          <Tag key={k} c={a[k] && palettes.effect?.[k] || '#ccc'} t={a[k] ?? 0} />
        ))}
      </div>
    );

    const sortTh = (
      label: string,
      key: typeof sortKey,
      extra?: string,
    ) => (
      <th
        className="px-2 py-1 cursor-pointer select-none"
        onClick={() => {
          if (sortKey === key) setSortAsc(!sortAsc);
          else {
            setSortKey(key);
            setSortAsc(true);
          }
        }}
      >
        {label}
        {sortKey === key && (sortAsc ? ' ▲' : ' ▼')}
        {extra}
      </th>
    );

    /* ------------------------------------------------------------------ */
    return (
      <div className="overflow-auto h-full bg-indigo-50/10">
        <table className="min-w-full text-sm border-collapse">
          <thead className="sticky top-0 bg-gray-100">
            <tr>
              {sortTh('Cluster', 'cluster')}
              {sortTh('Gene', 'gene')}

              {/* source checkboxes */}
              {(['Aβ42', 'Tau', 'αSyn'] as const).map((s) => (
                <th
                  key={s}
                  className="px-2 py-1 text-center select-none"
                >
                  <button
                    onClick={() => toggleSrc(s)}
                    className={`px-2 py-0.5 rounded-sm text-[13px] transition cursor-pointer
                      ${srcFilter.has(s)
                        ? 'bg-indigo-500 text-white'
                        : 'bg-indigo-200 hover:bg-indigo-300'}
                    `}
                  >
                    {s}
                  </button>
                </th>
              ))}

              <th className="px-2 py-1">Description</th>
              {sortTh('Num. Orthologs', 'ortho')}
              {sortTh('Max DIOPT score', 'score')}
              <th className="px-2 py-1">Orthologs</th>
            </tr>
          </thead>

          <tbody>
            {sorted.map((r) => {
              const isSel = selected.has(r.id);
              const maxScore = Math.max(...r.orthologs.map((o) => o.score), 0);
              return (
                <tr
                  key={r.id}
                  className={
                    isSel ? 'bg-indigo-50 cursor-pointer'
                          : 'cursor-pointer'
                  }
                  onClick={() => toggleRow(r.id)}
                  onMouseEnter={() => emit(new Set([r.id]))}
                  onMouseLeave={() => emit(selected)}
                >
                  {/* cluster badge */}
                  <td className="px-2 py-1 text-center">
                    <span
                      className="inline-block w-4 h-4 rounded"
                      style={{
                        background: palettes.cluster?.[r.cluster] ?? '#999',
                      }}
                    />
                  </td>

                  <td className="px-2 py-1 font-medium text-center">{r.name}</td>

                  {/* analysis cols */}
                  {(['Aβ42', 'Tau', 'αSyn'] as const).map((k) => {
                    const cell = r.sources[k];
                    return (
                      <td key={k} className="px-2 py-1 w-28">
                        {cell ? (
                          <div className="grid bg-white gap-[1px]">
                            <Tag c={palettes.source?.[k] || '#888'} t={k} />
                            <Tag
                              c={palettes.effect?.[cell.effect] || '#555'}
                              t={cell.effect}
                            />
                            <AlleleBar a={cell.alleles} />
                          </div>
                        ) : null}
                      </td>
                    );
                  })}
                  <td
                    className="px-2 py-1 max-w-md whitespace-normal  text-ellipsis"
                    title={r.description}
                  >
                    {r.description.length > 200 ? r.description.slice(0, 200) + ' [...]' : r.description }
                  </td>

                  <td className="px-2 py-1 text-center">
                    {r.orthologs?.length}
                  </td>

                  <td className="px-2 py-1 text-center">{maxScore}</td>

                  <td className="px-2 py-1 max-w-md">
                    {r.orthologs?.map((o) => (
                      <span
                        key={o.symbol}
                        className="inline-block mr-2 mb-1 rounded bg-gray-200 px-1"
                      >
                        {o.symbol} ({o.score})
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  },
);

GeneTable.displayName = 'GeneTable';
export default GeneTable;