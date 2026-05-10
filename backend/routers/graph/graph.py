import json
import logging
from datetime import datetime
from pathlib import Path
import asyncio
import sqlalchemy
from fastapi import APIRouter, HTTPException, Query, Request
from rag_state import get_rag_for_workspace, acquire_workspace_lock, release_workspace_lock, check_workspace_lock
from database import engine
from routers.graph.graph_type import EntityMergeRequest, SemanticDedupRequest

logger = logging.getLogger(__name__)

# prefix="/api" keeps all graph endpoints under /api/ like the rest of the backend
router = APIRouter(prefix="/api", tags=["Knowledge Graph"])

def _get_env_path() -> str:
    """Resolve the .env file path."""
    backend_root = Path(__file__).resolve().parent.parent.parent
    env_file = backend_root / ".env"
    if env_file.exists():
        return str(env_file)
    project_root = backend_root.parent
    return str(project_root / ".env")


def _save_dedup_log(workspace_id: str, threshold: float, apply_merge: bool, result: dict = None, error: str = None) -> Path:
    """Save dedup run result to a JSON log file."""
    log_dir = Path(__file__).resolve().parent.parent.parent / "logs" / "semantic_dedup"
    log_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    mode = "apply" if apply_merge else "dry"
    filename = f"{ts}_{workspace_id}_t{threshold:.2f}_{mode}.json"

    payload = {
        "timestamp": datetime.now().isoformat(),
        "workspace_id": workspace_id,
        "threshold": threshold,
        "apply_merge": apply_merge,
        "error": error,
        "result": result,
    }
    log_path = log_dir / filename
    log_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Semantic dedup log saved: %s", log_path)
    return log_path



@router.get("/graphs")
async def get_knowledge_graph(
    request: Request,
    label: str = Query(
        default="*",
        description="Entity label to start traversal from. Use '*' to include all entities.",
    ),
    max_depth: int = Query(
        default=3,
        ge=1,
        le=10,
        description="Maximum BFS depth from starting node.",
    ),
    max_nodes: int = Query(
        default=1000,
        ge=1,
        le=5000,
        description="Maximum number of nodes to return.",
    ),
) -> dict:
    """
    Query knowledge graph for a specific entity label (or all entities with '*').

    Returns subgraph as { nodes: [...], edges: [...], is_truncated: bool }.
    Backend uses BFS traversal up to max_depth hops.
    When node count exceeds max_nodes, closest/highest-degree nodes are prioritized.

    Response shape:
    {
      "nodes": [{"id": str, "labels": [str], "properties": {...}}, ...],
      "edges": [{"id": str, "source": str, "target": str, "type": str, "properties": {...}}, ...],
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
        # get_knowledge_graph is an async method on ExtendedLightRAG (inherits LightRAG)
        result = await rag.get_knowledge_graph(
            node_label=label,
            max_depth=max_depth,
            max_nodes=max_nodes,
        )
        # rag.get_knowledge_graph() returns a Pydantic model (KnowledgeGraph),
        # not a plain dict. FastAPI validates -> dict strictly, so we convert here.
        if isinstance(result, dict):
            return result
        return result.model_dump()

    except AttributeError as exc:
        # Method doesn't exist on this LightRAG version
        logger.error("get_knowledge_graph method not found: %s", exc)
        raise HTTPException(
            status_code=501,
            detail="Knowledge graph query not supported by the current LightRAG version.",
        ) from exc

    except Exception as exc:
        logger.error("Error in get_knowledge_graph: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    

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
    """
    Return the most popular entity labels sorted by degree (connection count).

    Primary: calls rag.chunk_entity_relation_graph.get_popular_labels(limit)
    Fallback: shallow graph query (*) + extract unique labels from nodes

    Response shape: { "labels": [str, ...] }
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

        # STEP 1: Try native method first (available in Neo4JStorage / NetworkXStorage)
        if hasattr(graph_storage, "get_popular_labels"):
            labels = await graph_storage.get_popular_labels(limit)
            return {"labels": labels}

        # STEP 2: Fallback — shallow BFS query and extract unique node labels
        logger.info("get_popular_labels not available, falling back to shallow graph query")
        graph_data = await rag.get_knowledge_graph(
            node_label="*",
            max_depth=1,
            max_nodes=limit * 3,
        )

        # graph_data may be a dict or a dataclass depending on LightRAG version
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
            label = node_labels[0] if node_labels else None
            if label and label not in seen:
                seen.add(label)
                labels.append(label)
                if len(labels) >= limit:
                    break

        return {"labels": labels}

    except Exception as exc:
        logger.error("Error in get_popular_labels: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/graph/label/search")
async def search_labels(
    request: Request,
    q: str = Query(
        default="",
        description="Search query string (case-insensitive substring match).",
    ),
    limit: int = Query(
        default=50,
        ge=1,
        le=200,
        description="Maximum number of results to return.",
    ),
) -> dict:
    """
    Search entity labels by keyword string (fuzzy/substring match).

    Primary: calls rag.chunk_entity_relation_graph.search_labels(q, limit)
    Fallback: shallow graph query (*) + filter labels by q.lower()

    Response shape: { "labels": [str, ...] }
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

        # STEP 1: Try native search method first
        if hasattr(graph_storage, "search_labels"):
            labels = await graph_storage.search_labels(q, limit)
            return {"labels": labels}

        # STEP 2: Fallback — shallow query + Python-side string filter
        logger.info("search_labels not available, falling back to shallow query + filter")
        graph_data = await rag.get_knowledge_graph(
            node_label="*",
            max_depth=1,
            max_nodes=500,
        )

        nodes = (
            graph_data.get("nodes", [])
            if isinstance(graph_data, dict)
            else getattr(graph_data, "nodes", [])
        )

        q_lower = q.lower()
        seen: set[str] = set()
        labels: list[str] = []
        for node in nodes:
            node_labels = (
                node.get("labels", [])
                if isinstance(node, dict)
                else getattr(node, "labels", [])
            )
            label = node_labels[0] if node_labels else None
            if label and label not in seen:
                # Match: empty query returns all, non-empty filters by substring
                if not q_lower or q_lower in label.lower():
                    seen.add(label)
                    labels.append(label)
                    if len(labels) >= limit:
                        break

        return {"labels": labels}

    except Exception as exc:
        logger.error("Error in search_labels: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc



@router.get("/graphs/nx")
async def get_nx_knowledge_graph(
    request: Request,
    label: str = Query(
        default="*",
        description="Entity label to start from. Use '*' for all entities.",
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
        description="Maximum nodes. Capped lower than /graphs for analytics perf.",
    ),
) -> dict:
    """
    Query knowledge graph và trả về dữ liệu NetworkX node_link_data format.

    Khác với /api/graphs, endpoint này:
    1. Build networkx.Graph từ LightRAG data
    2. Tính degree_centrality và community detection (greedy modularity)
    3. Serialize bằng json_graph.node_link_data(G, edges='links')
       → Format tương thích trực tiếp với D3.js force simulation

    Response shape (node_link_data format):
    {
      "directed": false,
      "multigraph": false,
      "graph": {},
      "nodes": [
        {
          "id": "EntityName",
          "label": "EntityName",
          "entity_type": "PERSON",
          "description": "...",
          "community": 2,
          "degree_centrality": 0.15,
          "degree": 5,
          "name": "EntityName"
        }
      ],
      "links": [
        {
          "source": "EntityA",
          "target": "EntityB",
          "weight": 1.5,
          "keywords": "CEO, founder"
        }
      ],
      "is_truncated": false
    }
    """
    import math
    import networkx as nx
    from networkx.readwrite import json_graph

    try:
        workspace_id = request.headers.get("X-Workspace-Id", "").strip()
        if not workspace_id:
            raise HTTPException(400, "Missing X-Workspace-Id header")
        lock_error = await check_workspace_lock(workspace_id)
        if lock_error:
            raise HTTPException(429, detail=lock_error)
        rag = await get_rag_for_workspace(workspace_id)

        # ── STEP 1: Lấy raw data từ LightRAG ────────────────────────
        result = await rag.get_knowledge_graph(
            node_label=label,
            max_depth=max_depth,
            max_nodes=max_nodes,
        )
        raw: dict = result if isinstance(result, dict) else result.model_dump()

        # ── STEP 2: Build NetworkX Graph ─────────────────────────────
        # Dùng nx.Graph (undirected) vì LightRAG knowledge graph
        # thường không phân biệt hướng rõ ràng ở mức visualization
        G: nx.Graph = nx.Graph()

        for node in raw.get("nodes", []):
            node_id: str = node["id"]
            props: dict = node.get("properties", {})
            labels_list: list = node.get("labels", [])
            # label: tên hiển thị = label[0] hoặc fallback sang id
            display_label: str = labels_list[0] if labels_list else node_id

            G.add_node(
                node_id,
                label=display_label,
                entity_type=props.get("entity_type", ""),
                description=props.get("description", ""),
                # name: D3 tooltip dùng field này (khớp với NetworkX guide)
                name=display_label,
            )

        for edge in raw.get("edges", []):
            source: str = edge["source"]
            target: str = edge["target"]
            edge_props: dict = edge.get("properties", {})

            # Chỉ add edge nếu cả 2 nodes tồn tại (guard cho dữ liệu bẩn)
            if G.has_node(source) and G.has_node(target) and source != target:
                G.add_edge(
                    source,
                    target,
                    weight=float(edge_props.get("weight", 1.0)),
                    keywords=edge_props.get("keywords", ""),
                )

        # ── STEP 3: NetworkX Analytics ───────────────────────────────
        # Guard: skip analytics nếu graph rỗng
        node_count: int = len(G.nodes())

        if node_count > 0:
            # Degree (số cạnh mỗi node có)
            degrees: dict[str, int] = dict(G.degree())

            # Degree centrality: normalized về [0, 1]
            # degree_centrality[v] = degree[v] / (n - 1)
            deg_centrality: dict[str, float] = nx.degree_centrality(G)

            # Community detection: greedy modularity maximization
            # Tìm nhóm nodes liên kết chặt với nhau
            communities: dict[str, int] = {}
            try:
                from networkx.algorithms import community as nx_community

                comm_list = list(
                    nx_community.greedy_modularity_communities(G, weight="weight")
                )
                for comm_id, comm_set in enumerate(comm_list):
                    for comm_node in comm_set:
                        communities[comm_node] = comm_id
            except Exception as comm_err:
                logger.warning("Community detection failed, using degree clusters: %s", comm_err)
                # Fallback: group by degree quartile (0–3)
                max_deg: int = max(degrees.values()) if degrees else 1
                for n_id, deg in degrees.items():
                    quartile: int = min(3, math.floor((deg / max(max_deg, 1)) * 4))
                    communities[n_id] = quartile
        else:
            degrees = {}
            deg_centrality = {}
            communities = {}

        # ── STEP 4: Enrich node attributes ─────────────────────────
        # Ghi analytics vào node attributes để json_graph serialize luôn
        for node_id in G.nodes():
            G.nodes[node_id]["community"] = communities.get(node_id, 0)
            G.nodes[node_id]["degree_centrality"] = deg_centrality.get(node_id, 0.0)
            G.nodes[node_id]["degree"] = degrees.get(node_id, 0)

        # ── STEP 5: Serialize sang node_link_data (D3 compatible) ───
        # edges="links" → D3 dùng "links" key (không phải "edges")
        # Đây là format chuẩn trong NetworkX guide cho D3 integration
        data: dict = json_graph.node_link_data(G, edges="links")

        # Thêm metadata từ LightRAG response
        data["is_truncated"] = raw.get("is_truncated", False)

        return data

    except AttributeError as exc:
        logger.error("get_knowledge_graph method not found: %s", exc)
        raise HTTPException(
            status_code=501,
            detail="Knowledge graph query not supported by current LightRAG version.",
        ) from exc

    except Exception as exc:
        logger.error("Error in get_nx_knowledge_graph: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


