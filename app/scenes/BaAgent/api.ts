import env from "~/env";
import { client } from "~/utils/ApiClient";
import type { SourceMetadata } from "@shared/types";
import type { AgentTool, GenerateSRSResponse, JobStatus, OutlineCollection, SrsResult } from "./type";

const BASE_URL = env.NEXT_PUBLIC_BASE_URL || "http://localhost:8000";

export async function getAgentToolByToolName(toolName: string): Promise<AgentTool> {
  const res = await fetch(
    `${BASE_URL}/tools_management/agent-tools/by-tool-name?toolName=${encodeURIComponent(toolName)}`
  );
  if (!res.ok) throw new Error("Failed to fetch agent tool");
  return res.json();
}

export interface RunToolPayload {
  agentTool: AgentTool;
  prompt: string;
  document: { id: string; title: string; content: string };
}

export async function runDocumentTool(payload: RunToolPayload): Promise<{ job_id: string }> {
  const res = await fetch(`${BASE_URL}/tools_management/run-tool`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to run tool");
  return res.json();
}

export async function listAgentTools(workspaceId: string): Promise<AgentTool[]> {
  const res = await fetch(
    `${BASE_URL}/tools_management/agent-tools/list?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.ok) throw new Error("Failed to fetch agent tools");
  return res.json();
}

export async function getAgentTool(
  workspaceId: string,
  sectionId: string
): Promise<AgentTool | null> {
  const res = await fetch(
    `${BASE_URL}/tools_management/agent-tools?workspaceId=${encodeURIComponent(workspaceId)}&sectionId=${encodeURIComponent(sectionId)}`
  );
  if (!res.ok) throw new Error("Failed to fetch agent tool");
  return res.json();
}

export async function deleteAgentTool(toolId: string): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/tools_management/agent-tools/${encodeURIComponent(toolId)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Failed to delete agent tool");
}

export async function upsertAgentTool(
  data: Omit<AgentTool, "id" | "createdAt" | "updatedAt">
): Promise<AgentTool> {
  const res = await fetch(`${BASE_URL}/tools_management/agent-tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to save agent tool");
  return res.json();
}

export async function generateSRS(
  file: File,
  prompt: string,
  workspaceId: string,
  sectionIds: string[]
): Promise<GenerateSRSResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("prompt", prompt);
  formData.append("workspaceId", workspaceId);
  formData.append("sectionIds", JSON.stringify(sectionIds));
  const res = await fetch(`${BASE_URL}/tools_management/generate-srs`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Failed to generate SRS");
  return res.json();
}

export async function pollJob(jobId: string): Promise<JobStatus> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BASE_URL}/tools_management/jobs/${jobId}`);
        if (!res.ok) {
          clearInterval(interval);
          reject(new Error("Failed to poll job status"));
          return;
        }
        const status: JobStatus = await res.json();
        if (status.status === "completed" || status.status === "failed") {
          clearInterval(interval);
          resolve(status);
        }
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, 3000);
  });
}

// --- Gemini API Key management ---

export interface GeminiKey {
  id: string;
  workspaceId: string;
  keyValue: string; // masked
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listGeminiKeys(workspaceId: string): Promise<GeminiKey[]> {
  const res = await fetch(
    `${BASE_URL}/gemini-keys?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  if (!res.ok) throw new Error("Failed to fetch Gemini API keys");
  return res.json();
}

export async function addGeminiKey(workspaceId: string, keyValue: string): Promise<GeminiKey> {
  const res = await fetch(`${BASE_URL}/gemini-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, keyValue }),
  });
  if (!res.ok) throw new Error("Failed to add Gemini API key");
  return res.json();
}

export async function deleteGeminiKey(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/gemini-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete Gemini API key");
}

export async function activateGeminiKey(id: string): Promise<GeminiKey> {
  const res = await fetch(
    `${BASE_URL}/gemini-keys/${encodeURIComponent(id)}/activate`,
    { method: "PUT" }
  );
  if (!res.ok) throw new Error("Failed to activate Gemini API key");
  return res.json();
}

export async function listCollections(): Promise<OutlineCollection[]> {
  const data = await client.post("/collections.list", { limit: 100 });
  return (data?.data ?? []).map((c: { id: string; name: string }) => ({
    id: c.id,
    name: c.name,
  }));
}

export async function createOutlineDocument(
  collectionId: string,
  title: string,
  text: string,
  options?: {
    parentDocumentId?: string;
    sourceMetadata?: Pick<SourceMetadata, "srsSection" | "srsType">;
  }
): Promise<{ id: string }> {
  const data = await client.post("/documents.create", {
    collectionId,
    title,
    text,
    publish: true,
    parentDocumentId: options?.parentDocumentId,
    sourceMetadata: options?.sourceMetadata,
  });
  return { id: data.data.id };
}

export async function createSrsDocuments(
  results: SrsResult[],
  collectionId: string
): Promise<void> {
  for (const result of results) {
    const title = `${result.section_id} - ${result.tool_name}`;
    await createOutlineDocument(collectionId, title, result.content, {
      sourceMetadata: { srsSection: result.section_id },
    });
  }
}
