"use client";

import { useEffect, useRef, useState } from "react";

export type JobSSEPayload = {
  jobId: string;
  jobType: string;
  projectId: string;
  runId?: string | null;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  message: string;
  costCents?: number;
  resultSummary?: unknown;
  error?: string;
};

type UseJobSSEResult = {
  lastEvent: JobSSEPayload | null;
  connected: boolean;
};

export function useJobSSE(projectId: string | null | undefined): UseJobSSEResult {
  const [lastEvent, setLastEvent] = useState<JobSSEPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      const es = new EventSource(`/api/projects/${projectId}/events`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        retryCountRef.current = 0;
      };

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as JobSSEPayload;
          setLastEvent(payload);
        } catch {
          // ignore malformed events
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();

        if (cancelled) return;
        const delayMs = Math.min(1000 * 2 ** retryCountRef.current, 30_000);
        retryCountRef.current += 1;
        retryTimeoutRef.current = setTimeout(connect, delayMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      eventSourceRef.current?.close();
      setConnected(false);
    };
  }, [projectId]);

  return { lastEvent, connected };
}
