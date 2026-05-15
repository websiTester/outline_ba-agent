export interface ConversationRecord {
  id: string;
  title: string;
  preview: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRecord {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface ListConversationsResponse {
  conversations: ConversationRecord[];
}

export interface ListMessagesResponse {
  messages: MessageRecord[];
}

export interface SendMessageResponse {
  user_message: MessageRecord;
  ai_message: MessageRecord;
}

export interface DeleteConversationResponse {
  deleted: boolean;
  id: string;
}
