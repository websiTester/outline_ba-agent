"""Knowledge Graph endpoints — read-only viewer support.

Minimal set per spec4:
  - GET /api/graphs/nx           → graph data in NetworkX node_link_data format
                                    (community detection + degree centrality)
  - GET /api/graph/label/popular → list of entity labels for filter dropdown

All endpoints require `X-Workspace-Id` header (injected by Node.js proxy from
`user.teamId`). Per-workspace `ExtendedLightRAG` instance ensures Neo4j
queries are filtered by workspace label — no cross-tenant data leakage.

Skipped from the reference implementation (per spec4 read-only scope):
  - /api/graphs (raw format — frontend uses /nx only)
  - /api/graph/label/search (frontend filters labels client-side)
  - /api/entity/details, /api/entities (frontend uses local node data)
  - /api/graph/entities/merge (mutation, scope=read-only)
  - /api/graph/semantic-dedup/* (admin feature, out of scope)
"""

from __future__ import annotations

import logging
import math

import networkx as nx
from fastapi import APIRouter, HTTPException, Query, Request
from networkx.algorithms import community as nx_community
from networkx.readwrite import json_graph

from rag_state import check_workspace_lock, get_rag_for_workspace

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["Knowledge Graph"])


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/graphs/nx — D3-compatible graph data with NetworkX analytics
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/graphs/nx")
async def get_nx_knowledge_graph(
    request: Request,
    label: str = Query(
        default="*",
        description="Entity label to start BFS from. Use '*' for all entities.",
    ),
    max_depth: int = Query(
        default=3,
        ge=1,
        le=10,
        description="Maximum BFS depth from starting node.",
    ),
    max_nodes: int = Query(
        default=500,
        ge=1,
        le=2000,
        description="Maximum nodes (lower than /graphs for analytics perf).",
    ),
) -> dict:
    """Return knowledge graph in `node_link_data` format enriched with analytics.

    Pipeline:
      1. BFS from `label` (or all entities if `*`), capped at `max_nodes`
      2. Build `networkx.Graph` (undirected) from LightRAG entities + relations
      3. Compute degree, degree_centrality, greedy modularity communities
      4. Serialize via `json_graph.node_link_data(G, edges="links")`

    Response shape:
        {
          "directed": false,
          "multigraph": false,
          "graph": {},
          "nodes": [
            { "id": str, "label": str, "entity_type": str, "description": str,
              "community": int, "degree_centrality": float, "degree": int,
              "name": str }
          ],
          "links": [
            { "source": str, "target": str, "weight": float, "keywords": str }
          ],
          "is_truncated": bool
        }
    """
    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        if not workspace_id:
            raise HTTPException(400, "Missing X-Workspace-Id header")

        lock_error = await check_workspace_lock(workspace_id)
        if lock_error:
            raise HTTPException(429, detail=lock_error)

        rag = await get_rag_for_workspace(workspace_id)

        # ── STEP 1: Fetch raw graph from LightRAG (Neo4j BFS) ─────────────
        result = await rag.get_knowledge_graph(
            node_label=label,
            max_depth=max_depth,
            max_nodes=max_nodes,
        )
        raw: dict = result if isinstance(result, dict) else result.model_dump()

        # ── STEP 2: Build NetworkX undirected graph ──────────────────────
        G: nx.Graph = nx.Graph()

        for node in raw.get("nodes", []):
            node_id: str = node["id"]
            props: dict = node.get("properties", {})
            labels_list: list = node.get("labels", [])
            display_label: str = labels_list[0] if labels_list else node_id

            G.add_node(
                node_id,
                label=display_label,
                entity_type=props.get("entity_type", ""),
                description=props.get("description", ""),
                # name: D3 tooltip convention (matches NetworkX guide)
                name=display_label,
            )

        for edge in raw.get("edges", []):
            source: str = edge["source"]
            target: str = edge["target"]
            edge_props: dict = edge.get("properties", {})

            # Guard against bad data: skip self-loops + endpoints with missing nodes
            if G.has_node(source) and G.has_node(target) and source != target:
                G.add_edge(
                    source,
                    target,
                    weight=float(edge_props.get("weight", 1.0)),
                    keywords=edge_props.get("keywords", ""),
                )

        # ── STEP 3: Analytics (skip if graph is empty) ────────────────────
        node_count: int = len(G.nodes())
        degrees: dict[str, int] = {}
        deg_centrality: dict[str, float] = {}
        communities: dict[str, int] = {}

        if node_count > 0:
            degrees = dict(G.degree())
            deg_centrality = nx.degree_centrality(G)

            # Community detection: greedy modularity maximization
            try:
                comm_list = list(
                    nx_community.greedy_modularity_communities(G, weight="weight")
                )
                for comm_id, comm_set in enumerate(comm_list):
                    for comm_node in comm_set:
                        communities[comm_node] = comm_id
            except Exception as comm_err:
                logger.warning(
                    "Community detection failed, falling back to degree quartile: %s",
                    comm_err,
                )
                max_deg: int = max(degrees.values()) if degrees else 1
                for n_id, deg in degrees.items():
                    quartile: int = min(3, math.floor((deg / max(max_deg, 1)) * 4))
                    communities[n_id] = quartile

        # ── STEP 4: Enrich node attributes ─────────────────────────────────
        for node_id in G.nodes():
            G.nodes[node_id]["community"] = communities.get(node_id, 0)
            G.nodes[node_id]["degree_centrality"] = deg_centrality.get(node_id, 0.0)
            G.nodes[node_id]["degree"] = degrees.get(node_id, 0)

        # ── STEP 5: Serialize to node_link_data (D3 compatible) ───────────
        # edges="links" → D3 force simulation expects "links" key
        data: dict = json_graph.node_link_data(G, edges="links")
        data["is_truncated"] = raw.get("is_truncated", False)

        return data

    except HTTPException:
        raise
    except AttributeError as exc:
        logger.error("get_knowledge_graph method not found: %s", exc)
        raise HTTPException(
            status_code=501,
            detail="Knowledge graph query not supported by current LightRAG version.",
        ) from exc
    except Exception as exc:
        logger.error("Error in get_nx_knowledge_graph: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/graph/label/popular — entity labels for filter dropdown
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/graph/label/popular")
async def get_popular_labels(
    request: Request,
    limit: int = Query(
        default=50,
        ge=1,
        le=500,
        description="Maximum number of labels to return.",
    ),
) -> dict:
    """Return entity labels sorted by popularity (Neo4j degree, descending).

    Primary path: native `Neo4JStorage.get_popular_labels(limit)`.
    Fallback path: shallow BFS query (`*`, depth=1) + extract unique labels
    when native method unavailable.

    Response shape: `{"labels": [str, ...]}`
    """
    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        if not workspace_id:
            raise HTTPException(400, "Missing X-Workspace-Id header")

        lock_error = await check_workspace_lock(workspace_id)
        if lock_error:
            raise HTTPException(429, detail=lock_error)

        rag = await get_rag_for_workspace(workspace_id)
        graph_storage = rag.chunk_entity_relation_graph

        # STEP 1: Try native Neo4JStorage method first (faster)
        if hasattr(graph_storage, "get_popular_labels"):
            labels = await graph_storage.get_popular_labels(limit)
            return {"labels": labels}

        # STEP 2: Fallback — shallow BFS query + extract unique labels
        logger.info(
            "get_popular_labels native method unavailable, using shallow BFS fallback"
        )
        graph_data = await rag.get_knowledge_graph(
            node_label="*",
            max_depth=1,
            max_nodes=limit * 3,
        )
        nodes = (
            graph_data.get("nodes", [])
            if isinstance(graph_data, dict)
            else getattr(graph_data, "nodes", [])
        )

        seen: set[str] = set()
        labels: list[str] = []
        for node in nodes:
            node_labels = (
                node.get("labels", [])
                if isinstance(node, dict)
                else getattr(node, "labels", [])
            )
            lbl = node_labels[0] if node_labels else None
            if lbl and lbl not in seen:
                seen.add(lbl)
                labels.append(lbl)
                if len(labels) >= limit:
                    break

        return {"labels": labels}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error in get_popular_labels: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
