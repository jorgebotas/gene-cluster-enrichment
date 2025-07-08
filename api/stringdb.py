import pandas as pd
import networkx as nx
from typing import Optional
from tqdm import tqdm
import requests
import numpy as np
from scipy.stats import hypergeom
from statsmodels.stats.multitest import multipletests

class FunctionalEnrichment:
    def __init__(
            self, 
            mapping_file: str, 
            categories=(
                'Biological Process (Gene Ontology)',
                'Reactome Pathways'
        )):
        # cols: protein_id, term_id, category, description
        df = pd.read_csv(mapping_file, sep='\t', header=None, comment='#',
                         names=['protein','category','term','description'])
        df["category"] = df["category"].str.strip()
        df = df[df['category'].isin(categories)]
        self.description = df.set_index('term')['description'].to_dict()
        # build cat → term → set(genes) dictionary
        pivot = (
            df.groupby(['category', 'term'])
              .agg({'protein': lambda x: set(x)})
              .unstack(level=0)['protein']      # columns = categories
        )
        self.cat2term2genes = {
            cat: pivot[cat].dropna().to_dict()  # NaN rows = term with zero genes
            for cat in pivot.columns
        }
        # background universe is every protein appearing in any term
        self.background = set(df['protein'].unique())

    def _hyper(self, term_genes, study_genes):
        N = len(self.background)
        M = len(term_genes)
        n = len(study_genes)
        K = len(term_genes & study_genes)
        # sf = P(X ≥ K)
        return hypergeom.sf(K-1, N, M, n) if K else 1.0

    def enrich(self, study_genes, fdr_cut=0.05):
        study_genes = set(study_genes) & self.background
        records = []
        for cat, t2g in self.cat2term2genes.items():
            for term, genes in t2g.items():
                p = self._hyper(genes, study_genes)
                records.append((cat, term, p, len(genes & study_genes),
                                len(genes), len(study_genes), list(study_genes)))
        out = pd.DataFrame(records, columns=[
            'category','term', 'p','overlap',
            'term_size','study_size', 'inputGenes'
        ])

        if out.empty:
            return out

        # Map descriptions
        out["description"] = out['term'].map(self.description)

        out['fdr'] = multipletests(out.p, method='fdr_bh')[1]
        out = out[out.fdr <= fdr_cut].copy()
        return out.sort_values('fdr').reset_index(drop=True)

def compute_prior_away(score: float, prior: float = 0.041):
    if score < prior:
        score = prior
    return (score - prior) / (1 - prior)

def combine_scores(subscores, prior=0.041):
    # Remove prior
    corrected = [compute_prior_away(s, prior) for s in subscores]
    
    # Combine using 1 - Π(1 - score)
    combined_no_prior = 1.0
    for s in corrected:
        combined_no_prior *= (1.0 - s)
    combined = (1.0 - combined_no_prior)
    
    # Add prior back
    combined = combined * (1.0 - prior) + prior
    return combined


from functools import lru_cache
@lru_cache(maxsize=1)
def functional_enrichment(mapping_file: str):
    return FunctionalEnrichment(mapping_file)

class StringAPI:
    EDGE_SOURCES = {
        "neighborhood": "nscore",
        "fusion": "fscore",
        "phylogenetic": "pscore",
        "coexpression": "ascore",
        "experimental": "escore",
        "database": "dscore",
        "textmining": "tscore"
    }
    def __init__(
            self, 
            species: int,
            genes: Optional[list] = None,
            identifiers: Optional[list] = None,
            api_url: str = "https://version-12-0.string-db.org/api",
            caller_identity: str = "bcm.edu",
            functional_enrichment_file: Optional[str] = None
        ):
        self.species = species
        self.api_url = api_url
        self.caller_identity = caller_identity
        if identifiers:
            self.gene_ids = list(set(identifiers))
            self.genes = self.gene_ids
        elif genes:
            self.genes = list(set(genes))
            self.identifiers = self.get_identifiers()

            if self.identifiers.empty:
                raise ValueError("No STRING identifiers found for the provided genes.")
            
            print(f"Found {len(self.identifiers)} STRING identifiers for the provided genes.")

            if len(self.identifiers.string_identifier.unique()) < len(self.identifiers):
                print(f"{self.identifiers.string_identifier.nunique()} unique STRING identifiers.")
                print("Warning: Some genes have multiple STRING identifiers. This may affect downstream analyses.")
            
            self.gene_ids = self.identifiers.string_identifier.unique().tolist()
        else:
            raise ValueError("Must provide either genes or identifiers")

        if functional_enrichment_file:
            self._functional_enrichment = functional_enrichment(
                mapping_file=functional_enrichment_file
            )

    def get_identifiers(self):
        output_format = "tsv-no-header"
        method = "get_string_ids"

        ##
        ## Set parameters
        ##

        params = {

            "identifiers" : "\r".join(self.genes), # your protein list
            "species" : self.species, # NCBI/STRING taxon identifier 
            "echo_query" : 1, # see your input identifiers in the output
            "caller_identity" : self.caller_identity

        }

        ##
        ## Construct URL
        ##


        request_url = "/".join([self.api_url, output_format, method])

        ##
        ## Call STRING
        ##

        results = requests.post(request_url, data=params)

        ##
        ## Read and parse the results
        ##

        input_identifiers = []
        string_identifiers = []
        for line in results.text.strip().split("\n"):
            l = line.split("\t")
            if len(l) < 3:
                continue
            input_identifier, string_identifier = l[0], l[2]
            input_identifiers.append(input_identifier)
            string_identifiers.append(string_identifier)
        
        identifiers = pd.DataFrame({
            "input_identifier": input_identifiers,
            "string_identifier": string_identifiers
        })
        return identifiers


    def ppi_enrichment(self):
        output_format = "tsv-no-header"
        method = "ppi_enrichment"

        ##
        ## Construct the request
        ##

        request_url = "/".join([self.api_url, output_format, method])

        ##
        ## Set parameters
        ##

        params = {

            "identifiers" : "%0d".join(self.gene_ids), # your proteins
            "species" : 7227, # NCBI/STRING taxon identifier 
            "caller_identity" : self.caller_identity # your app name

        }

        ##
        ## Call STRING
        ##

        response = requests.post(request_url, data=params)

        ##
        ## Parse and print the respons Parse and print the responsee
        ##

        for line in response.text.strip().split("\n"):
            pvalue = line.split("\t")[5]
            return pvalue

    def get_interactions(
            self, 
            confidence: float = 0.4, 
            exclude: set = set(),
        ):

        output_format = "json"
        method = "network"
        request_url = "/".join([self.api_url, output_format, method])

        params = {
            "identifiers": "%0d".join(self.gene_ids),
            "species": self.species,
            "required_score": confidence * 1000,  # LOWER THAN final threshold, to re-filter later
            "caller_identity": self.caller_identity
        }

        response = requests.post(request_url, data=params)
        data = response.json()

        final_interactions = []
        prior = 0.041
        exclude = {self.EDGE_SOURCES[k] for k in exclude} if exclude else set()

        for entry in data:
            # Extract sub-scores and divide by 1000 to match [0,1] scale
            scores = {
                "nscore": entry.get("nscore", 0),
                "fscore": entry.get("fscore", 0),
                "pscore": entry.get("pscore", 0),
                "ascore": entry.get("ascore", 0),
                "escore": entry.get("escore", 0),
                "dscore": entry.get("dscore", 0),
                "tscore": entry.get("tscore", 0),
            }

            subscores = [
                v for k, v in scores.items() if k not in exclude
            ]

            recombined = combine_scores(subscores, prior)

            if recombined >= confidence:
                entry["recomputed_score"] = recombined
                final_interactions.append(entry)

        return final_interactions

    def build_network(self, interactions):
        G = nx.Graph()

        data = [
            (entry["stringId_A"], entry["stringId_B"], entry["recomputed_score"])
            for entry in interactions
        ]
        G.add_weighted_edges_from(data)
        return G

    def mcl_clustering(self, network, inflation: float = 3, min_cluster_size: int = 2):
        import markov_clustering as mc
        import scipy.sparse as sp

        matrix = nx.to_scipy_sparse_array(network)
        result = mc.run_mcl(sp.csr_matrix(matrix), inflation=inflation, verbose=False)
        clusters = mc.get_clusters(result)

        # Filter clusters by minimum size
        clusters = [c for c in clusters if len(c) >= min_cluster_size]

        # Sort clusters by descending size
        sorted_clusters = sorted(clusters, key=lambda x: -len(x))  # Largest first

        # Map node index → preferred name using graph
        nodes = list(network.nodes())

        # Create mapping
        name_to_cluster = {}
        for cluster_id, cluster in enumerate(sorted_clusters):
            for node_index in cluster:
                name = nodes[node_index]
                name_to_cluster[name] = cluster_id

        from collections import defaultdict

        clusters = defaultdict(list)
        for name, cid in name_to_cluster.items():
            clusters[cid].append(name)

        return clusters, name_to_cluster

    def functional_enrichment(
            self, 
            genes: Optional[list] = None, 
            fdr: float = 0.05
        ) -> pd.DataFrame:
        genes = genes or self.gene_ids

        if hasattr(self, "_functional_enrichment"):
            return self._functional_enrichment.enrich(genes, fdr_cut=fdr)

        output_format = "json"
        method = "enrichment"


        ##
        ## Construct the request
        ##

        request_url = "/".join([self.api_url, output_format, method])

        ##
        ## Set parameters
        ##

        params = {

            "identifiers" : "%0d".join(genes), # your protein
            "species" : self.species, # NCBI/STRING taxon identifier 
            "caller_identity" : self.caller_identity # your app name

        }

        ##
        ## Call STRING
        ##

        response = requests.post(request_url, data=params)

        ##
        ## Read and parse the results
        ##

        data = response.json()
        results = pd.DataFrame.from_dict(data)
        try:
            results = results[results["fdr"] <= fdr].copy()
        except KeyError:
            # No enrichment found
            pass
        return results

    def mcl_functional_enrichment(
            self, 
            clusters: dict,
            fdr: float = 0.05,
            min_cluster_size: int = 2,
        ) -> pd.DataFrame:

        enrichment_results = []
        # string_to_name = self.identifiers.set_index("string_identifier")["input_identifier"].to_dict()
        for cluster_id, cluster_genes in tqdm(clusters.items()):
            if len(cluster_genes) < min_cluster_size:
                continue

            enrichment = self.functional_enrichment(cluster_genes, fdr=fdr)

            if enrichment.empty:
                continue

            enrichment["cluster"] = cluster_id
            enrichment["cluster_size"] = len(cluster_genes)
            # cluster_genes = [string_to_name.get(g, g) for g in cluster_genes]
            enrichment["cluster_genes"] = len(enrichment) * [cluster_genes]
            enrichment_results.append(enrichment)

        return pd.concat(enrichment_results)

    def get_top_enrichment(
            self, 
            enrichment: pd.DataFrame,
            top_k: int = 2,
        ):
        top_enrichment = []
        for _, group in enrichment.groupby("cluster"):
            group.sort_values("fdr", inplace=True)
            gobp = group[group["category"].str.contains("Process")].copy()
            gobp["category"] = "GOBP"
            kegg = group[group["category"].str.contains("KEGG")].copy()
            kegg["category"] = "KEGG"
            reactome = group[
                (group["category"].str.contains("RCTM")) |
                (group["category"].str.contains("Reactome"))
            ].copy()
            reactome["category"] = "RCTM"
            top_enrichment.append(pd.concat([
                gobp.head(top_k), kegg.head(top_k), reactome.head(top_k)
            ]))
        return pd.concat(top_enrichment).reset_index(drop=True)
