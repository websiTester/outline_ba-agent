import type { Message } from "../types";
import { AIResponseArticle } from "./AIResponseArticle";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  const isAgent: boolean = message.role === "agent";

  if (isAgent) {
    return (
      <div className="mb-10 w-full min-w-0">
        <AIResponseArticle
          content={message.content}
          timestamp={message.timestamp}
        />
      </div>
    );
  }

  return (
    <div className="mb-8 flex justify-end">
      <div className="max-w-3xl">
        <div className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5 text-right">
          You
        </div>
        <div className="text-slate-900 dark:text-slate-100">
          <p className="text-[13px] leading-[1.6] whitespace-pre-wrap">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}
