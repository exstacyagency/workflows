import { useEffect, useState } from "react";

export interface TimelineMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface LiveState {
  timeline: TimelineMessage[];
  isTyping: boolean;
}

type Listener = (state: LiveState) => void;

const listeners = new Map<string, Set<Listener>>();
const subscribedSessionIds = new Set<string>();
let source: EventSource | null = null;
let states: Record<string, LiveState> = {};

function getOrCreate(channelId: string): LiveState {
  if (!states[channelId]) {
    states[channelId] = { timeline: [], isTyping: false };
  }
  return states[channelId];
}

function notify(channelId: string) {
  listeners.get(channelId)?.forEach((fn) => fn({ ...states[channelId] }));
}

function ensureConnected(sseUrl: string) {
  if (source) return;

  source = new EventSource(sseUrl);

  // Outbound message = assistant reply
  source.addEventListener("outbound_message", (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as {
        channel_id?: string;
        text?: string;
      };
      console.log("SSE outbound_message channel_id:", data.channel_id);
      console.log("Listening for sessionId:", Array.from(subscribedSessionIds).join(", "));
      const cid = String(data.channel_id ?? "").trim();
      if (!cid) return;

      const state = getOrCreate(cid);
      state.isTyping = false;
      const text = String(data.text ?? "").trim();
      if (text) {
        state.timeline = [
          ...state.timeline,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: text,
          },
        ];
      }
      states[cid] = state;
      notify(cid);
    } catch {
      // ignore malformed events
    }
  });

  // Typing state
  source.addEventListener("typing_state", (event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data) as {
        channel_id?: string;
        is_typing?: boolean;
      };
      const cid = String(data.channel_id ?? "").trim();
      if (!cid) return;

      const state = getOrCreate(cid);
      state.isTyping = data.is_typing ?? false;
      states[cid] = state;
      notify(cid);
    } catch {
      // ignore malformed events
    }
  });

  source.onerror = () => {
    source?.close();
    source = null;
    setTimeout(() => ensureConnected(sseUrl), 2000);
  };
}

export function useSpacebotSSE(sessionId: string, sseUrl: string): LiveState {
  const [state, setState] = useState<LiveState>({ timeline: [], isTyping: false });

  useEffect(() => {
    if (!sessionId) return;
    ensureConnected(sseUrl);

    if (!listeners.has(sessionId)) {
      listeners.set(sessionId, new Set());
    }
    const set = listeners.get(sessionId)!;
    set.add(setState);
    subscribedSessionIds.add(sessionId);

    if (states[sessionId]) {
      setState({ ...states[sessionId] });
    }

    return () => {
      set.delete(setState);
      if (set.size === 0) {
        listeners.delete(sessionId);
      }
      subscribedSessionIds.delete(sessionId);
    };
  }, [sessionId, sseUrl]);

  return state;
}
