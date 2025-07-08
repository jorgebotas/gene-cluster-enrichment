from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import pandas as pd

from api.stringdb import StringAPI

# Initialize the Flask app
app = Flask(__name__)
CORS(app)

SPECIES = 7227
EDGE_SOURCES = set(StringAPI.EDGE_SOURCES.keys())

modifiers = pd.read_csv("data/celltype-modifiers.csv")
modifiers = modifiers[
    (modifiers.model.isin(["AB42", "TauWT", "aSyn"])) &
    # (modifiers.model.isin(["AB42"])) &
    (modifiers.pval_adj < 0.05)
].copy()
modifiers["effect"] = modifiers["modifier_type"]
gene_mapping_exceptions = {
    "Ady43A": "Adk3",
    "TMS1": "Serinc"
}
for k, v in gene_mapping_exceptions.items():
    modifiers.loc[modifiers.gene == k, "gene"] = v

gene_df = pd.read_csv(f"data/{SPECIES}.protein.info.v12.0.txt", sep="\t")
gene_df.columns = ["string_id", "name", "length", "description"]
gene_data = gene_df.set_index("string_id").to_dict(orient="index")

modifiers["string_id"] = modifiers.gene.map(
    gene_df.set_index("name").string_id
)
modifiers = modifiers[modifiers.string_id.notna()].copy()

# Load mofifier summary data for gene table
with open("data/modifier-data.json", "r") as f:
    modifier_data = json.load(f)


def filter_modifiers(modifiers, analyses=None, effect=None):
    """Filter modifiers based on analyses and effect."""
    if analyses:
        modifiers = modifiers[modifiers['disease'].isin(analyses)]
    if effect:
        modifiers = modifiers[modifiers['effect'].isin(effect)]
    return modifiers

@app.route('/api/graph-data', methods=['POST'])
def graph_data():
    """Return nodes / edges / enrichment with user-defined filters."""
    cfg       = request.get_json(silent=True) or {}
    analyses  = set(cfg.get('analyses', []))
    effect  = set(cfg.get('effects', []))
    confidence  = float(cfg.get('confidence', 0.4))
    include_src   = set(cfg.get('edgeSources', EDGE_SOURCES))
    exclude_src   = EDGE_SOURCES - include_src                 # pass to STRING API

    df = filter_modifiers(modifiers, analyses=analyses, effect=effect)
    string = StringAPI(
        species = SPECIES,
        identifiers = df.string_id.unique().tolist(),
        functional_enrichment_file = f"data/{SPECIES}.protein.enrichment.terms.v12.0.txt",
    )
    interactions = string.get_interactions(
        exclude=exclude_src, 
        confidence=confidence
    )

    network = string.build_network(interactions)

    clusters, name_to_cluster = string.mcl_clustering(network, inflation=2)
    enrichment = string.mcl_functional_enrichment(clusters, fdr=0.05)
    top_enrichment = string.get_top_enrichment(enrichment)
    top_clusters = top_enrichment["cluster"].unique().tolist()
    top_enrichment["source"] = top_enrichment["category"].map({
        "KEGG": "KEGG",
        "RCTM": "Reactome Pathways",
        "GOBP": "Gene Ontology Biological Process",
        "Biological Process (Gene Ontology)": "Biological Process (Gene Ontology)",
        "Reactome Pathways": "Reactome Pathways"
    })
    enrichment = [
        {
            "cluster": row["cluster"], 
            "pathwayId": row["term"], 
            "pathway": row["description"], 
            "fdr": row["fdr"],
            "source": row["source"],
            "genes": row["inputGenes"],
        }
        for _, row in top_enrichment.iterrows() if row["cluster"] in top_clusters
    ]
    name_to_cluster = { 
        k: v for k, v in name_to_cluster.items() if v in top_clusters 
    }

    source = modifiers.groupby("string_id")["disease"].unique()
    effect = modifiers.groupby("string_id")["modifier_type"].unique()
    
    nodes = [
        { "data": {
            "id": node_id,
            "name": gene_data[node_id]["name"],
            "cluster": cluster_id,
            "source": source[node_id].tolist(),
            "effect": effect[node_id].tolist()
        }
    } for node_id, cluster_id in name_to_cluster.items() ]

    # Flask side – when you build edges
    edges = []
    for row in interactions:
        a, b = row["stringId_A"], row["stringId_B"]
        if a not in name_to_cluster or b not in name_to_cluster:
            continue
        intra = name_to_cluster[a] == name_to_cluster[b]
        edges.append({
            "data": {
                "source": a,
                "target": b,
                "intra": intra
            }
        })

    return jsonify({'nodes': nodes, 'edges': edges, 'enrichment': enrichment})


@app.route('/api/node-details/<node_id>')
def get_node_details(node_id):
    """This endpoint serves detailed information for a single node."""
    details = gene_data.get(node_id)
    if details:
        details["link"] = f"https://flybase.org/reports/{node_id.split('.')[-1]}"
        return jsonify(details)
    else:
        # Return a default response if no specific details are found
        return jsonify({
            "description": "No detailed description available for this gene.",
            "link": "#"
        })

# @app.route('/api/gene-table/<node_ids>')
@app.route('/api/gene-table')
def get_gene_table():
    """This endpoint serves detailed information for multiple nodes."""
    # ids = node_ids.split(',')
    data = []
    for d in modifier_data:
        # if d["id"] in ids:
        data.append({
            **d,
            "link": f"https://flybase.org/reports/{d['id'].split('.')[-1]}"
        })
    return jsonify(data)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
    # app.run(host="0.0.0.0", port=5000, debug=True)
