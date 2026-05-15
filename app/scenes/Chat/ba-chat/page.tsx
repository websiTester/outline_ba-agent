import { useCallback, useEffect, useState } from "react";
import useStores from "~/hooks/useStores";
import GeminiKeyModal from "~/scenes/BaAgent/components/GeminiKeyModal";
import { ChatConversation } from "./components/ChatConversation";
import { toDisplayConversation, toDisplayMessage } from "./helper";
import {
  createConversation,
  deleteConversation,
  fetchConversations,
  fetchMessages,
  isGeminiKeyError,
  renameConversation,
  sendMessage,
} from "./lib/api";
import type { GeminiKeyError } from "./lib/api";
import type { Conversation, Message, QuickAction } from "./types";

function BAChatPage() {
  const { dialogs } = useStores();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  );
  const [conversationMessages, setConversationMessages] = useState<
    Record<string, Message[]>
  >({});
  const [typingConversationIds, setTypingConversationIds] = useState<Set<string>>(
    new Set()
  );

  const messages = activeConversationId
    ? conversationMessages[activeConversationId] ?? []
    : [];

  const chatTitle =
    conversations.find((c) => c.id === activeConversationId)?.title ??
    "AI Assistant";

  const openGeminiKeyModal = useCallback(() => {
    dialogs.openModal({
      title: "Gemini API Keys",
      content: <GeminiKeyModal />,
      width: "520px",
    });
  }, [dialogs]);

  const handleDeleteConversation = async (id: string) => {
    const previousConversations = conversations;
    const remainingConvs = conversations.filter((c) => c.id !== id);
    const isActiveBeingDeleted = activeConversationId === id;

    setConversations(remainingConvs);

    if (isActiveBeingDeleted) {
      if (remainingConvs.length > 0) {
        const nextConv = remainingConvs[0];
        setActiveConversationId(nextConv.id);
        setConversations(
          remainingConvs.map((c, i) => ({ ...c, isActive: i === 0 }))
        );
        if (!conversationMessages[nextConv.id]) {
          await loadMessages(nextConv.id);
        }
      } else {
        setActiveConversationId(null);
      }
    }

    setConversationMessages((prev) => {
      const updated = { ...prev };
      delete updated[id];
      return updated;
    });

    try {
      await deleteConversation(id);
    } catch {
      setConversations(previousConversations);
      if (isActiveBeingDeleted) {
        setActiveConversationId(id);
      }
    }
  };

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const data = await fetchMessages(conversationId);
      const displayMessages = data.messages.map(toDisplayMessage);
      setConversationMessages((prev) => ({
        ...prev,
        [conversationId]: displayMessages,
      }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchConversations()
      .then((data) => {
        const convList = data.conversations.map((c, i) =>
          toDisplayConversation(c, i === 0)
        );
        setConversations(convList);
        if (convList.length > 0) {
          setActiveConversationId(convList[0].id);
          void loadMessages(convList[0].id);
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, [loadMessages]);

  const handleNewChat = async () => {
    try {
      const newConvRecord = await createConversation("New conversation");
      const newConv = toDisplayConversation(newConvRecord, true);
      setConversations((prev) => [
        newConv,
        ...prev.map((c) => ({ ...c, isActive: false })),
      ]);
      setConversationMessages((prev) => ({ ...prev, [newConv.id]: [] }));
      setActiveConversationId(newConv.id);
    } catch {
      /* ignore */
    }
  };

  const handleSelectConversation = async (id: string) => {
    setActiveConversationId(id);
    setConversations((prev) =>
      prev.map((c) => ({ ...c, isActive: c.id === id }))
    );
    if (!conversationMessages[id]) {
      await loadMessages(id);
    }
  };

  const handleSendMessage = async (content: string) => {
    let conversationId = activeConversationId;

    // CASE B: no active conversation → lazy auto-create
    if (!conversationId) {
      try {
        const newConvRecord = await createConversation("New conversation");
        const newConv = toDisplayConversation(newConvRecord, true);
        setConversations([newConv]);
        setConversationMessages((prev) => ({ ...prev, [newConv.id]: [] }));
        setActiveConversationId(newConv.id);
        conversationId = newConv.id;
      } catch {
        return;
      }
    }

    // Optimistic user message
    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    const convId = conversationId;
    setConversationMessages((prev) => ({
      ...prev,
      [convId]: [...(prev[convId] ?? []), tempUserMessage],
    }));

    setTypingConversationIds((prev) => new Set(prev).add(convId));

    try {
      const data = await sendMessage(convId, content);
      const aiMessage = toDisplayMessage(data.ai_message);
      setConversationMessages((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] ?? []), aiMessage],
      }));
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                preview: content.substring(0, 60),
                title:
                  c.title === "New conversation"
                    ? content.trim().substring(0, 60)
                    : c.title,
              }
            : c
        )
      );
    } catch (err) {
      if (isGeminiKeyError(err)) {
        const geminiErr = err as GeminiKeyError;
        if (geminiErr.errorCode === "GEMINI_KEY_MISSING") {
          openGeminiKeyModal();
        } else if (geminiErr.errorCode === "GEMINI_QUOTA_EXHAUSTED") {
          const errorMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content: geminiErr.message,
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          };
          setConversationMessages((prev) => ({
            ...prev,
            [convId]: [...(prev[convId] ?? []), errorMessage],
          }));
          openGeminiKeyModal();
        } else {
          const errorMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: "agent",
            content: geminiErr.message,
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          };
          setConversationMessages((prev) => ({
            ...prev,
            [convId]: [...(prev[convId] ?? []), errorMessage],
          }));
        }
      } else {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "agent",
          content:
            "Sorry, an error occurred while processing your question. Please try again.",
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
        setConversationMessages((prev) => ({
          ...prev,
          [convId]: [...(prev[convId] ?? []), errorMessage],
        }));
      }
    } finally {
      setTypingConversationIds((prev) => {
        const s = new Set(prev);
        s.delete(convId);
        return s;
      });
    }
  };

  const handleRenameConversation = async (id: string, newTitle: string) => {
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) {
      return;
    }
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: trimmedTitle } : c))
    );
    try {
      await renameConversation(id, trimmedTitle);
    } catch {
      fetchConversations()
        .then((data) => {
          const convList = data.conversations.map((c) =>
            toDisplayConversation(c, c.id === activeConversationId)
          );
          setConversations(convList);
        })
        .catch(() => {
          /* ignore */
        });
    }
  };

  const quickActions: QuickAction[] = [
    {
      id: "1",
      icon: "sparkles",
      title: "Ask about uploaded documents",
      description:
        "Answer questions related to the content of uploaded documents",
      onClick: () => {
        /* placeholder */
      },
    },
    {
      id: "2",
      icon: "file",
      title: "Summarize a document",
      description: "Get a concise overview of an uploaded document",
      onClick: () => {
        /* placeholder */
      },
    },
  ];

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <div className="absolute inset-0 flex overflow-hidden bg-white dark:bg-[#111319]">
        <ChatConversation
          messages={messages}
          quickActions={quickActions}
          onSendMessage={handleSendMessage}
          isTyping={typingConversationIds.has(activeConversationId ?? "")}
          chatTitle={chatTitle}
          conversations={conversations}
          onSelectConversation={handleSelectConversation}
          onNewChat={handleNewChat}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
        />
      </div>
    </div>
  );
}

export default BAChatPage;
