import { getCookie } from "tiny-cookie";
import type {
  ClearDocumentsResponse,
  DeleteDocumentsResponse,
  DocumentListResponse,
  GraphLabelsResponse,
  NxGraphResponse,
  PipelineStatusResponse,
  UploadResponse,
} from "./api.type";

/**
 * Knowledge Graph API client.
 *
 * All requests go to Outline's Node.js routes (same-origin), which proxy
 * to the Python FastAPI backend. The Node.js layer injects
 *   X-Workspace-Id: user.teamId
 * automatically — frontend never sees or sets a workspace ID.
 *
 * CSRF token must be included on all mutating calls (matches Outline's
 * CSRF middleware on POST routes).
 */

// Map Python endpoint paths → Node.js proxy route names. Kept for parity
// with the reference project — useful when migrating or comparing logs.
const GRAPH_ROUTE_MAP: Record<string, string> = {
  "/api/documents/delete": "/api/graph.documents.delete",
  "/api/documents/clear": "/api/graph.documents.clear",
  "/api/pipeline/status": "/api/graph.pipeline.status",
  "/api/documents": "/api/graph.documents.list",
  "/api/upload-document": "/api/graph.documents.upload",
  "/api/graphs/nx": "/api/graph.data.nx",
  "/api/graph/label/popular": "/api/graph.labels.popular",
};

/** Thrown when the backend returns 429 with workspace-locked error details. */
export class WorkspaceLockError extends Error {
  readonly isWorkspaceLock = true as const;
  detail: Record<string, unknown>;
  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkspaceLockError";
    this.detail = detail;
  }
}

/** Identity-safe type guard (avoids `instanceof` pitfalls under HMR). */
export function isWorkspaceLockError(err: unknown): err is WorkspaceLockError {
  if (err instanceof WorkspaceLockError) {
    return true;
  }
  return (
    err !== null &&
    typeof err === "object" &&
    (err as Record<string, unknown>).isWorkspaceLock === true
  );
}

function getChatHeaders(): Record<string, string> {
  const csrfToken = getCookie("csrfToken");
  return {
    "Content-Type": "application/json",
    ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
  };
}

/**
 * Shared fetch wrapper for JSON Knowledge Graph calls.
 *
 * Routes through the Node.js proxy (same-origin) so the auth cookie is
 * automatically attached and `X-Internal-Secret` is added server-side.
 */
async function graphFetch(
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<Response> {
  const nodeRoute = GRAPH_ROUTE_MAP[endpoint];
  if (!nodeRoute) {
    throw new Error(`[graphFetch] No Node.js proxy route for: ${endpoint}`);
  }

  const response = await fetch(nodeRoute, {
    method: "POST",
    credentials: "include",
    headers: getChatHeaders(),
    body: JSON.stringify(body),
  });

  if (response.status === 429) {
    const err = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const detail = (err.detail ?? err) as Record<string, unknown>;
    throw new WorkspaceLockError(
      typeof detail === "string"
        ? detail
        : ((detail?.message as string) ?? "Workspace is busy"),
      typeof detail === "object" ? detail : {}
    );
  }

  return response;
}

/**
 * Upload a single document (multipart). Returns once the Python backend has
 * accepted the file and queued indexing — actual processing runs async on
 * the backend. Caller polls `apiFetchDocuments()` to track status.
 */
export async function uploadDocument(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  // Multipart upload — let the browser set Content-Type with boundary.
  const csrfToken = getCookie("csrfToken");
  const headers: Record<string, string> = {};
  if (csrfToken) {
    headers["x-csrf-token"] = csrfToken;
  }

  const response = await fetch("/api/graph.documents.upload", {
    method: "POST",
    credentials: "include",
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => ({}))) as {
      detail?: string;
    };
    throw new Error(errorData.detail || response.statusText);
  }

  // The Node.js proxy renames Python's `status` to `upload_status` because
  // the apiResponse middleware overwrites `status` with the HTTP code.
  const raw = (await response.json()) as {
    upload_status?: string;
    message?: string;
    file_name?: string;
    track_id?: string;
    file_size?: number;
  };
  return {
    status: (raw.upload_status as UploadResponse["status"]) ?? "error",
    message: raw.message ?? "",
    file_name: raw.file_name ?? file.name,
    track_id: raw.track_id,
    file_size: raw.file_size,
  };
}

/**
 * List documents with pagination, status filter, search, and sort.
 *
 * Returned status values: "pending" | "processing" | "preprocessed" |
 * "processed" | "failed" — frontend maps "deleting" locally based on
 * localStorage-tracked IDs (see deleting-ids-storage.ts in M7).
 */
export async function apiFetchDocuments(
  status?: string,
  page: number = 1,
  pageSize: number = 20,
  sortField: string = "updated_at",
  sortDirection: string = "desc",
  search?: string
): Promise<DocumentListResponse> {
  const response = await fetch("/api/graph.documents.list", {
    method: "POST",
    credentials: "include",
    headers: getChatHeaders(),
    body: JSON.stringify({
      status,
      search,
      page,
      page_size: pageSize,
      sort_field: sortField,
      sort_direction: sortDirection,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[API] fetchDocuments failed ${response.status}: ${text}`);
  }

  return (await response.json()) as DocumentListResponse;
}

/**
 * Delete a list of documents (async — returns immediately with
 * "deletion_started"; backend processes in a background task).
 *
 * Frontend should:
 *   1. Optimistically mark these IDs as "deleting" in localStorage
 *   2. Poll apiFetchDocuments() every ~2s
 *   3. Remove from "deleting" tracking when the ID disappears from the list
 *
 * @param docIds     LightRAG doc IDs (read from `doc.id` directly).
 * @param deleteFile Kept for API parity — backend ignores it post-PG migration.
 */
export async function apiDeleteDocuments(
  docIds: string[],
  deleteFile: boolean = true
): Promise<DeleteDocumentsResponse> {
  const response = await graphFetch("/api/documents/delete", {
    doc_ids: docIds,
    delete_file: deleteFile,
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      detail?: string;
    };
    throw new Error(
      err.detail ?? `[API] apiDeleteDocuments failed ${response.status}`
    );
  }

  return (await response.json()) as DeleteDocumentsResponse;
}

/**
 * Clear all documents in the current workspace (drops all 11 LightRAG
 * storages in parallel). Synchronous on the backend — may take several
 * seconds; UI should show a loading state.
 */
export async function apiClearDocuments(): Promise<ClearDocumentsResponse> {
  const response = await graphFetch("/api/documents/clear", {});

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      detail?: string;
    };
    throw new Error(
      err.detail ?? `[API] apiClearDocuments failed ${response.status}`
    );
  }

  return (await response.json()) as ClearDocumentsResponse;
}

/**
 * Fetch pipeline busy state (RAM flag; resets on backend restart).
 *
 * Used to:
 *   1. Gate Delete/Clear buttons while pipeline is indexing
 *   2. Auto-refresh document list at faster cadence (2s) when busy=true
 *
 * Never throws — returns a safe default on network errors so the polling
 * loop in DocumentManager doesn't crash on transient failures.
 */
export async function apiFetchPipelineStatus(): Promise<PipelineStatusResponse> {
  const fallback: PipelineStatusResponse = {
    busy: false,
    job_name: "-",
    cur_batch: 0,
    batchs: 0,
  };
  try {
    const response = await graphFetch("/api/pipeline/status", {});
    if (!response.ok) {
      return fallback;
    }
    return (await response.json()) as PipelineStatusResponse;
  } catch {
    return fallback;
  }
}

/**
 * Fetch knowledge graph data in NetworkX node_link_data format.
 *
 * The backend runs:
 *   1. BFS from `label` (or all entities if `*`), capped at `maxNodes`
 *   2. Builds an undirected networkx.Graph
 *   3. Computes degree_centrality + greedy_modularity_communities
 *   4. Serializes via `json_graph.node_link_data(G, edges="links")`
 *
 * The viewer feeds the response directly into D3 force simulation.
 */
export async function apiFetchNxGraph(
  label: string,
  maxDepth: number,
  maxNodes: number
): Promise<NxGraphResponse> {
  const response = await graphFetch("/api/graphs/nx", {
    label,
    max_depth: maxDepth,
    max_nodes: maxNodes,
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `[API] apiFetchNxGraph failed ${response.status}`
    );
  }

  return (await response.json()) as NxGraphResponse;
}

/**
 * Fetch the most popular entity labels for the workspace.
 *
 * Used to populate the LabelCheckboxPanel filter dropdown in the Knowledge
 * Graph viewer. Filtering itself is client-side; this only seeds the choices.
 */
export async function apiFetchPopularLabels(
  limit: number = 50
): Promise<string[]> {
  const response = await graphFetch("/api/graph/label/popular", { limit });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(
      err.detail ?? `[API] apiFetchPopularLabels failed ${response.status}`
    );
  }

  const data = (await response.json()) as GraphLabelsResponse;
  return data.labels;
}
