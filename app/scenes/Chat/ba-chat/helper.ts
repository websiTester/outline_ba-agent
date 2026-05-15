import type { Conversation, Message } from "./types";

interface BackendMessageRecord {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface BackendConversationRecord {
  id: string;
  title: string;
  preview: string;
  updated_at: string;
}

export function toDisplayMessage(m: BackendMessageRecord): Message {
  return {
    id: m.id,
    role: m.role === "assistant" ? "agent" : "user",
    content: m.content,
    timestamp: new Date(m.created_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export function toDisplayConversation(
  c: BackendConversationRecord,
  isActive: boolean = false
): Conversation {
  return {
    id: c.id,
    title: c.title,
    preview: c.preview,
    timestamp: new Date(c.updated_at).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    }),
    isActive,
  };
}
