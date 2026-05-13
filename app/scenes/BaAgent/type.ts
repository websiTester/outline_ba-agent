export interface AgentTool {
  id: string;
  workspaceId: string;
  sectionId: string;
  toolName: string;
  model: string;
  toolDescription: string;
  defaultPrompt: string;
  instruction: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GenerateSRSResponse {
  job_id: string;
}

export interface SrsResult {
  tool_name: string;
  section_id: string;
  content: string;
}

export interface JobStatus {
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
  results?: SrsResult[];
}

export interface OutlineCollection {
  id: string;
  name: string;
}
