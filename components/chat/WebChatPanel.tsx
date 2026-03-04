"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useJobSSE } from "@/hooks/useJobSSE";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
};

type WebChatPanelProps = {
  projectId: string;
  variant?: "fixed" | "sidebar";
};

export function WebChatPanel({ projectId, variant = "fixed" }: WebChatPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [wsConnected, setWsConnected] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [openClawWsUrl, setOpenClawWsUrl] = useState<string>("ws://localhost:18789/webchat");
  const [gatewayToken, setGatewayToken] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const { lastEvent } = useJobSSE(open ? projectId : null);

  const addMessage = useCallback((msg: Omit<Message, "id" | "createdAt">) => {
    setMessages((prev) => [
      ...prev,
      {
        ...msg,
        id: crypto.randomUUID(),
        createdAt: new Date(),
      },
    ]);
  }, []);

  useEffect(() => {
    if (!projectId) return;

    fetch("/api/config/public", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const resolved = String(data?.openClawWsUrl ?? "").trim();
        if (resolved) setOpenClawWsUrl(resolved);
        const token = String(data?.openClawGatewayToken ?? "").trim();
        if (token) setGatewayToken(token);
      })
      .catch(() => undefined);

    fetch("/api/user/openclaw-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (typeof data?.sessionKey === "string") {
          setSessionKey(data.sessionKey);
        }
      })
      .catch(() => undefined);

    return () => {
      fetch("/api/user/openclaw-session", { method: "DELETE" }).catch(() => undefined);
    };
  }, [projectId]);

  useEffect(() => {
    if (!open || !sessionKey) return;

    const ws = new WebSocket(
      `${openClawWsUrl}?sessionKey=${encodeURIComponent(sessionKey)}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      // Send OpenClaw handshake frame first
      ws.send(JSON.stringify({
        type: "req",
        method: "connect",
        id: crypto.randomUUID(),
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "webchat",
            platform: "web",
            mode: "webchat",
            version: "1.0.0",
          },
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          caps: [],
          auth: { token: gatewayToken },
          locale: "en-US",
          userAgent: navigator.userAgent,
        },
      }));
    };

    ws.onmessage = (event) => {
      console.log("[WebChat] received:", event.data);
      try {
        const parsed = JSON.parse(event.data);
        // Connect acknowledgement
        if (parsed?.type === "res" && parsed?.ok === true && parsed?.payload?.type === "hello-ok") {
          setWsConnected(true);
          addMessage({ role: "system", content: "Connected. Ask me anything about this project." });
          return;
        }
        // Ignore challenge and system events
        if (parsed?.type === "event" && parsed?.event === "connect.challenge") return;
        if (parsed?.type === "res") return; // ack for chat.send etc.

        // Assistant message event
        if (parsed?.type === "event" && parsed?.event === "chat.message") {
          const msg = parsed?.data?.message ?? parsed?.data;
          if (msg?.role === "assistant") {
            addMessage({ role: "assistant", content: String(msg?.content ?? "") });
          }
          return;
        }

        if (parsed?.type === "event" && parsed?.event === "chat") {
          const msg = parsed?.payload?.message;
          const state = parsed?.payload?.state;
          const text = msg?.content?.[0]?.text ?? "";

          if (!text) return;

          if (state === "delta" || state === "final") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: text }];
              }
              return [
                ...prev,
                { id: crypto.randomUUID(), role: "assistant", content: text, createdAt: new Date() },
              ];
            });
          }
          return;
        }

        // Handle streaming agent response
        if (parsed?.type === "event" && parsed?.event === "agent") {
          const data = parsed?.payload?.data;
          const stream = parsed?.payload?.stream;

          if (stream === "text" && data?.text) {
            // Streaming text chunk — append to last assistant message or add new one
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: last.content + data.text }];
              }
              return [
                ...prev,
                { id: crypto.randomUUID(), role: "assistant", content: data.text, createdAt: new Date() },
              ];
            });
            return;
          }

          if (stream === "lifecycle" && data?.phase === "done") {
            // Run complete
            return;
          }
          return;
        }

        // Fallback
        addMessage({
          role: "assistant",
          content: String(parsed?.content ?? parsed?.message ?? event.data),
        });
      } catch {
        addMessage({ role: "assistant", content: String(event.data) });
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
    };

    ws.onerror = () => {
      setWsConnected(false);
      addMessage({ role: "system", content: "Connection lost. Reconnecting..." });
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setWsConnected(false);
    };
  }, [open, sessionKey, openClawWsUrl, gatewayToken, addMessage]);

  useEffect(() => {
    if (!lastEvent) return;
    addMessage({ role: "assistant", content: lastEvent.message });
  }, [lastEvent, addMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !sessionKey || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    console.log("[WebChat] sessionKey:", sessionKey);
    addMessage({ role: "user", content: text });
    setSending(true);
    setInput("");
    wsRef.current.send(JSON.stringify({
      type: "req",
      method: "chat.send",
      id: crypto.randomUUID(),
      params: {
        sessionKey: "agent:main:main",
        message: text,
        idempotencyKey: crypto.randomUUID(),
      },
    }));
    setSending(false);
    inputRef.current?.focus();
  }, [input, sessionKey, addMessage]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  if (variant === "sidebar") {
    return (
      <div className="flex h-full flex-col border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Assistant</span>
          <span className={`h-2 w-2 rounded-full ${wsConnected ? "bg-green-400" : "bg-zinc-400"}`} />
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask or start a job..."
              rows={1}
              disabled={!wsConnected}
              className="max-h-32 flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800"
            />
            <button
              onClick={sendMessage}
              disabled={!wsConnected || !input.trim() || sending}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              type="button"
              aria-label="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {open ? (
        <div
          className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
          style={{ width: 380, height: 520 }}
        >
          <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Assistant</span>
              <span className={`h-2 w-2 rounded-full ${wsConnected ? "bg-green-400" : "bg-zinc-400"}`} />
            </div>
            <button
              onClick={() => setOpen(false)}
              type="button"
              className="text-lg leading-none text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
              aria-label="Close chat"
            >
              ×
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-zinc-100 px-3 py-3 dark:border-zinc-800">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask or start a job..."
                rows={1}
                disabled={!wsConnected}
                className="max-h-32 flex-1 resize-none rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                style={{ minHeight: 38 }}
              />
              <button
                onClick={sendMessage}
                disabled={!wsConnected || !input.trim() || sending}
                type="button"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700"
        aria-label={open ? "Close assistant" : "Open assistant"}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
      </button>
    </div>
  );
}

function ChatMessage({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <p className="py-1 text-center text-xs text-zinc-400 dark:text-zinc-500">{message.content}</p>
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
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
