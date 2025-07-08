import { useEffect, useRef, useState } from "react";
import ClusterEnrichment, {
  ClusterEnrichmentHandle
} from "./components/ClusterEnrichment";
import GeneTable, {
  GeneTableHandle
} from "./components/GeneTable";
import DynamicContainer from "./components/DynamicContainer";
import "./index.css";

const API = "http://slytherin.nri.bcm.edu/api"

// ✅ Drop the hero header for now; focus on the workspace
export function App() {
  const clusterEnrichmentRef = useRef<ClusterEnrichmentHandle>(null);
  const geneTableRef = useRef<GeneTableHandle>(null);

  /* state that will re-render GeneTable */
  const [palettes, setPalettes] = useState<
    Record<string, Record<string, string>>
  >({});

  useEffect(() => {
    if (clusterEnrichmentRef.current) {
      setPalettes(clusterEnrichmentRef.current.getPalettes());
    }
  }, [clusterEnrichmentRef]);
  return (
    <div className="w-screen h-screen">
    <DynamicContainer direction="vertical" sizes={[200/3, 100/3]}>
      <div className="h-full w-screen">
        <ClusterEnrichment
            ref={clusterEnrichmentRef}
            dataEndpoint={`${API}/graph-data`}
            nodeDetailsEndpoint={(nodeId: string) =>
              `${API}/node-details/${nodeId}`
            }
            onGenesSelect={(ids: string[]) => {
              geneTableRef.current?.selectGenes(ids);
            }}
        />
      </div>
      <div className="h-full w-screen">
        <GeneTable
            ref={geneTableRef}
            endpoint={`${API}/gene-table`}
            palettes={palettes}
            onGenesSelect={(ids: string[]) => {
              clusterEnrichmentRef.current?.selectGenes(ids);
            }}
        />
      </div>
    </DynamicContainer>
    </div>
  );
}

export default App;
