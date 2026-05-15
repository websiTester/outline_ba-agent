import type { Document } from "../document-manager/types/document";

/** Response from POST /api/graph.documents.upload (multipart).
 *
 * Note: the Node.js proxy renames Python's `status` field to `upload_status`
 * because the apiResponse middleware overwrites `status` with the HTTP code.
 * The wrapper in `api.ts` reads `upload_status` and exposes it as `status`.
 */
export interface UploadResponse {
  status: "success" | "duplicate" | "error";
  message: string;
  track_id?: string;
  file_name: string;
  file_size?: number;
}

/** Response from POST /api/graph.documents.list */
export interface DocumentListResponse {
  documents: Document[];
  total: number;
  page: number;
  page_size: number;
}

/** Response from POST /api/graph.documents.delete.
 *
 * Python returns immediately with "deletion_started"; the actual deletion
 * runs in a FastAPI background task. Frontend polls /api/graph.documents.list
 * to detect when deleted docs disappear.
 */
export interface DeleteDocumentsResponse {
  status: "deletion_started" | "busy";
  message: string;
  doc_ids: string[];
}

/** Response from POST /api/graph.documents.clear.
 *
 * Synchronous on the Python side — waits for all 11 storages to drop before
 * returning. May take several seconds for large graphs.
 */
export interface ClearDocumentsResponse {
  status: "success" | "partial_success" | "busy";
  message: string;
  total_deleted: number;
}

/** Response from POST /api/graph.pipeline.status */
export interface PipelineStatusResponse {
  busy: boolean;
  job_name: string;
  cur_batch: number;
  batchs: number;
  /** Set when a workspace lock (indexing/dedup/merging) is held — not just pipeline busy. */
  workspace_locked?: boolean;
}

// ── Knowledge Graph (Nx node_link_data format) ──────────────────────────────

/**
 * A node in the NetworkX `node_link_data` format.
 *
 * Backend enriches each node with analytics (community, degree_centrality,
 * degree) via `nx.degree_centrality` + `greedy_modularity_communities`.
 *
 * Runtime mutation note: D3 force simulation injects `x, y, vx, vy, fx, fy`
 * onto each node object after `simulation.nodes()` is called.
 */
export interface NxNode {
  /** Node identifier — D3 force simulation uses this as key */
  id: string;
  /** Display label (= entity_id in LightRAG) */
  label: string;
  /** Entity type from LightRAG extraction: "PERSON", "ORGANIZATION", etc. May be empty. */
  entity_type: string;
  /** LLM-generated entity description */
  description: string;
  /** Community ID from greedy_modularity_communities (0-based) */
  community: number;
  /** Degree centrality normalized to [0, 1] */
  degree_centrality: number;
  /** Edge count for this node */
  degree: number;
  /** Alias of label — D3 tooltip convention (NetworkX guide) */
  name: string;
  // D3 simulation runtime fields — D3 mutates these after init
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  /** null = unpinned (free), number = pinned at fixed position */
  fx?: number | null;
  fy?: number | null;
}

/**
 * An edge in the NetworkX `node_link_data` format.
 *
 * IMPORTANT: D3 force simulation MUTATES source/target from string IDs into
 * NxNode object references after `simulation.force("link")` is configured.
 * Type is `string | NxNode` to handle both before-resolve and after-resolve.
 */
export interface NxLink {
  /** Source node ID (string before D3 resolves, NxNode after) */
  source: string | NxNode;
  /** Target node ID (string before D3 resolves, NxNode after) */
  target: string | NxNode;
  /** Relationship strength — scales edge stroke-width */
  weight: number;
  /** Comma-separated relation keywords: "CEO, founder, leads" */
  keywords: string;
}

/**
 * Response from POST /api/graph.data.nx — D3 node_link_data format.
 *
 * Result of `networkx.readwrite.json_graph.node_link_data(G, edges="links")`
 * with `is_truncated` flag added by the backend.
 */
export interface NxGraphResponse {
  /** false — backend uses nx.Graph (undirected) */
  directed: boolean;
  /** false — no parallel edges */
  multigraph: boolean;
  /** Graph-level attributes (usually empty {}) */
  graph: Record<string, unknown>;
  nodes: NxNode[];
  /** Edges keyed as "links" per D3 force convention (NOT "edges") */
  links: NxLink[];
  /** True when backend capped results at max_nodes */
  is_truncated?: boolean;
}

/**
 * Response from POST /api/graph.labels.popular — entity labels for filter dropdown.
 */
export interface GraphLabelsResponse {
  labels: string[];
}
