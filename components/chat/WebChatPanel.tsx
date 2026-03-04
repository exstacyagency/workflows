"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJobSSE } from "@/hooks/useJobSSE";
import { useSpacebotSSE } from "@/hooks/useSpacebotSSE";
import { useWebChat } from "@/hooks/useWebChat";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
};

type WebChatPanelProps = {
  agentId?: "creative" | "research" | "billing" | "support";
  // projectId is required for project-scoped agents (creative, research).
  // Omit for user-scoped agents (billing, support) — session key becomes
  // {agentId}:webchat-{userId} with no project suffix.
  projectId?: string;
  variant?: "fixed" | "sidebar";
  // Offset from the bottom of the viewport (px). Use when multiple fixed
  // panels would otherwise stack on top of each other.
  // Defaults to 24 (matches bottom-6 = 1.5rem = 24px).
  bottomOffset?: number;
};

// eslint-disable-next-line no-restricted-properties
const SPACEBOT_SSE_URL = process.env.NEXT_PUBLIC_SPACEBOT_EVENTS_URL ?? "/api/spacebot/events";

export function WebChatPanel({
  agentId = "creative",
  projectId,
  variant = "fixed",
  bottomOffset = 24,
}: WebChatPanelProps) {
  const [open, setOpen] = useState(variant === "sidebar");
  const [input, setInput] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Array<{ id: string; content: string }>>([]);
  const [jobMessages, setJobMessages] = useState<Array<{ id: string; content: string }>>([]);
  const [bootError, setBootError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const uid = data?.user?.id;
        if (!uid) throw new Error("No user session");
        setUserId(uid);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBootError(err instanceof Error ? err.message : "Failed to initialize chat");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedUserId = userId;
  // projectId is passed through as optional — useWebChat/getSessionId handles
  // both scoped formats correctly.
  const { sessionId, isSending, error, sendMessage } = useWebChat(
    agentId,
    resolvedUserId ?? "",
    projectId,
  );
  const { timeline, isTyping } = useSpacebotSSE(resolvedUserId ? sessionId : "", SPACEBOT_SSE_URL);
  // useJobSSE is only relevant for project-scoped agents; skip when no projectId.
  const { lastEvent } = useJobSSE(open && projectId ? projectId : null);

  useEffect(() => {
    console.log("sessionId:", sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!lastEvent) return;
    setJobMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        content: String(lastEvent.message ?? `${lastEvent.jobType} ${lastEvent.status}`),
      },
    ]);
  }, [lastEvent]);

  useEffect(() => {
    if (timeline.length > 0) {
      setOptimistic([]);
    }
  }, [timeline.length]);

  const wsConnected = useMemo(() => Boolean(userId), [userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [timeline.length, optimistic.length, jobMessages.length, isTyping]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !wsConnected || isSending || isTyping || !resolvedUserId) return;

    setInput("");
    setOptimistic((prev) => [...prev, { id: crypto.randomUUID(), content: text }]);

    // Append projectId context only for project-scoped agents.
    const contextMessage = projectId
      ? `[context: projectId=${projectId}]\n\n${text}`
      : text;
    await sendMessage(contextMessage);
    inputRef.current?.focus();
  }, [input, wsConnected, isSending, isTyping, projectId, resolvedUserId, sendMessage]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const combinedMessages: Message[] = [
    ...timeline.map((msg) => ({
      id: msg.id,
      role: msg.role as const,
      content: msg.content,
      createdAt: new Date(),
    })),
    ...optimistic.map((msg) => ({
      id: msg.id,
      role: "user" as const,
      content: msg.content,
      createdAt: new Date(),
    })),
    ...jobMessages.map((msg) => ({
      id: msg.id,
      role: "system" as const,
      content: msg.content,
      createdAt: new Date(),
    })),
  ];

  if (variant === "sidebar") {
    return (
      <div className="flex h-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <Header title={agentId} wsConnected={wsConnected} />
        <MessageList messages={combinedMessages} isTyping={isTyping} error={bootError ?? error} messagesEndRef={messagesEndRef} />
        <Composer
          inputRef={inputRef}
          input={input}
          setInput={setInput}
          onKeyDown={onKeyDown}
          onSend={handleSend}
          disabled={!wsConnected || isSending || isTyping}
        />
      </div>
    );
  }

  return (
    <div className="fixed right-6 z-50 flex flex-col items-end gap-2" style={{ bottom: bottomOffset }}>
      {open ? (
        <div
          className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          style={{ width: 380, height: 520 }}
        >
          <Header title={agentId} wsConnected={wsConnected} onClose={() => setOpen(false)} />
          <MessageList messages={combinedMessages} isTyping={isTyping} error={bootError ?? error} messagesEndRef={messagesEndRef} />
          <Composer
            inputRef={inputRef}
            input={input}
            setInput={setInput}
            onKeyDown={onKeyDown}
            onSend={handleSend}
            disabled={!wsConnected || isSending || isTyping}
          />
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700"
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>
    </div>
  );
}

function Header({
  title,
  wsConnected,
  onClose,
}: {
  title: string;
  wsConnected: boolean;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold capitalize text-zinc-800 dark:text-zinc-100">{title}</span>
        <span className={`h-2 w-2 rounded-full ${wsConnected ? "bg-green-400" : "bg-zinc-400"}`} />
      </div>
      {onClose ? (
        <button
          onClick={onClose}
          type="button"
          className="text-lg leading-none text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label="Close chat"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function MessageList({
  messages,
  isTyping,
  error,
  messagesEndRef,
}: {
  messages: Message[];
  isTyping: boolean;
  error: string | null;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}

      {isTyping ? (
        <div className="flex items-center gap-1.5 py-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:0.2s]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 [animation-delay:0.4s]" />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      ) : null}

      <div ref={messagesEndRef} />
    </div>
  );
}

function Composer({
  inputRef,
  input,
  setInput,
  onKeyDown,
  onSend,
  disabled,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  return (
    <div className="border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask or start a job..."
          rows={1}
          disabled={disabled}
          className="max-h-32 flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          style={{ minHeight: 38 }}
        />
        <button
          onClick={onSend}
          disabled={disabled || !input.trim()}
          type="button"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

function ChatMessage({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <p className="py-1 text-center text-xs text-zinc-400 dark:text-zinc-500">
        {message.content}
      </p>
    );
  }

  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "rounded-br-sm bg-blue-600 text-white"
            : "rounded-bl-sm bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
