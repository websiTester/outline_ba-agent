import { getCookie } from "tiny-cookie";
import type {
  ConversationRecord,
  DeleteConversationResponse,
  ListConversationsResponse,
  ListMessagesResponse,
  SendMessageResponse,
} from "./api.type";

/**
 * Chat API client. All requests flow through Outline's Node.js routes
 * (same-origin), which proxy to the Python FastAPI backend. The proxy
 * injects X-Workspace-Id (teamId) + X-User-Key (userId) automatically.
 */

const CHAT_ROUTES = {
  list: "/api/chat.conversations.list",
  create: "/api/chat.conversations.create",
  rename: "/api/chat.conversations.rename",
  delete: "/api/chat.conversations.delete",
  messagesList: "/api/chat.messages.list",
  messagesSend: "/api/chat.messages.send",
} as const;

/** Structured error code surfaced by the Python backend. */
export type GeminiErrorCode =
  | "GEMINI_KEY_MISSING"
  | "GEMINI_QUOTA_EXHAUSTED"
  | "RAG_UNAVAILABLE";

export class GeminiKeyError extends Error {
  readonly isGeminiKeyError = true as const;
  readonly errorCode: GeminiErrorCode;
  constructor(errorCode: GeminiErrorCode, message: string) {
    super(message);
    this.name = "GeminiKeyError";
    this.errorCode = errorCode;
  }
}

export function isGeminiKeyError(err: unknown): err is GeminiKeyError {
  if (err instanceof GeminiKeyError) {
    return true;
  }
  return (
    err !== null &&
    typeof err === "object" &&
    (err as Record<string, unknown>).isGeminiKeyError === true
  );
}

function getChatHeaders(): Record<string, string> {
  const csrfToken = getCookie("csrfToken");
  return {
    "Content-Type": "application/json",
    ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
  };
}

async function chatFetch(
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: getChatHeaders(),
    body: JSON.stringify(body),
  });
}

/**
 * Translate non-2xx responses into structured errors. Recognises Python's
 * `detail = { error_code, message }` shape and throws `GeminiKeyError` for
 * Gemini-specific failures; other errors throw a generic Error.
 */
async function throwIfNotOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) {
    return;
  }
  const payload = (await response
    .json()
    .catch(() => ({}))) as Record<string, unknown>;
  // Node.js proxy wraps Python's detail under `error`.
  const detail = (payload.error ?? payload.detail) as unknown;
  if (
    detail !== null &&
    typeof detail === "object" &&
    typeof (detail as Record<string, unknown>).error_code === "string"
  ) {
    const d = detail as { error_code: string; message?: string };
    if (
      d.error_code === "GEMINI_KEY_MISSING" ||
      d.error_code === "GEMINI_QUOTA_EXHAUSTED" ||
      d.error_code === "RAG_UNAVAILABLE"
    ) {
      throw new GeminiKeyError(
        d.error_code,
        d.message ?? fallback
      );
    }
  }
  const message =
    typeof detail === "string"
      ? detail
      : typeof payload.error === "string"
        ? payload.error
        : fallback;
  throw new Error(message);
}

export async function fetchConversations(): Promise<ListConversationsResponse> {
  const response = await chatFetch(CHAT_ROUTES.list, {});
  await throwIfNotOk(response, "Failed to list conversations");
  return (await response.json()) as ListConversationsResponse;
}

export async function createConversation(
  title: string = "New conversation"
): Promise<ConversationRecord> {
  const response = await chatFetch(CHAT_ROUTES.create, { title });
  await throwIfNotOk(response, "Failed to create conversation");
  return (await response.json()) as ConversationRecord;
}

export async function renameConversation(
  conversationId: string,
  title: string
): Promise<ConversationRecord> {
  const response = await chatFetch(CHAT_ROUTES.rename, {
    conversation_id: conversationId,
    title,
  });
  await throwIfNotOk(response, "Failed to rename conversation");
  return (await response.json()) as ConversationRecord;
}

export async function deleteConversation(
  conversationId: string
): Promise<DeleteConversationResponse> {
  const response = await chatFetch(CHAT_ROUTES.delete, {
    conversation_id: conversationId,
  });
  await throwIfNotOk(response, "Failed to delete conversation");
  return (await response.json()) as DeleteConversationResponse;
}

export async function fetchMessages(
  conversationId: string
): Promise<ListMessagesResponse> {
  const response = await chatFetch(CHAT_ROUTES.messagesList, {
    conversation_id: conversationId,
  });
  await throwIfNotOk(response, "Failed to list messages");
  return (await response.json()) as ListMessagesResponse;
}

export async function sendMessage(
  conversationId: string,
  content: string
): Promise<SendMessageResponse> {
  const response = await chatFetch(CHAT_ROUTES.messagesSend, {
    conversation_id: conversationId,
    content,
  });
  await throwIfNotOk(response, "Failed to send message");
  return (await response.json()) as SendMessageResponse;
}
