import { z } from "zod";
import { BaseSchema } from "../schema";

// ── Conversations ───────────────────────────────────────────────────────────

export const ChatConversationsListSchema = BaseSchema.extend({
  body: z.object({}),
});
export type ChatConversationsListReq = z.infer<typeof ChatConversationsListSchema>;

export const ChatConversationsCreateSchema = BaseSchema.extend({
  body: z.object({
    title: z.string().optional().default("New conversation"),
  }),
});
export type ChatConversationsCreateReq = z.infer<typeof ChatConversationsCreateSchema>;

export const ChatConversationsRenameSchema = BaseSchema.extend({
  body: z.object({
    conversation_id: z.string().min(1),
    title: z.string().min(1),
  }),
});
export type ChatConversationsRenameReq = z.infer<typeof ChatConversationsRenameSchema>;

export const ChatConversationsDeleteSchema = BaseSchema.extend({
  body: z.object({
    conversation_id: z.string().min(1),
  }),
});
export type ChatConversationsDeleteReq = z.infer<typeof ChatConversationsDeleteSchema>;

// ── Messages ────────────────────────────────────────────────────────────────

export const ChatMessagesListSchema = BaseSchema.extend({
  body: z.object({
    conversation_id: z.string().min(1),
  }),
});
export type ChatMessagesListReq = z.infer<typeof ChatMessagesListSchema>;

export const ChatMessagesSendSchema = BaseSchema.extend({
  body: z.object({
    conversation_id: z.string().min(1),
    content: z.string().min(1),
  }),
});
export type ChatMessagesSendReq = z.infer<typeof ChatMessagesSendSchema>;
