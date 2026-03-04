import { useCallback, useState } from "react";

export function getSessionId(agentId: string, userId: string, projectId?: string) {
  return projectId
    ? `${agentId}:webchat-${userId}:${projectId}`
    : `${agentId}:webchat-${userId}`;
}

export function useWebChat(agentId: string, userId: string, projectId?: string) {
  const sessionId = getSessionId(agentId, userId, projectId);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;

      setError(null);
      setIsSending(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, sessionId, message: trimmed, userId, projectId }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setIsSending(false);
      }
    },
    [agentId, sessionId, userId, projectId, isSending],
  );

  return { sessionId, isSending, error, sendMessage };
}
