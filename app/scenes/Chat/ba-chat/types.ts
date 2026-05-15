export type MessageRole = "agent" | "user";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  isActive?: boolean;
}

export interface QuickAction {
  id: string;
  icon: string;
  title: string;
  description: string;
  onClick: () => void;
}
