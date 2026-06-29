"use client";

/**
 * Client hook for the SSE realtime stream (Section 11). Subscribes to one or more board
 * channels and surfaces (a) a callback on each authorized event and (b) live presence.
 *
 * The server has ALREADY authorized every event for this user before it reaches the stream
 * (src/app/api/stream/route.ts) — the client trusts what arrives and never re-decides scope.
 * EventSource auto-reconnects on drop; the stream is additive, so a dropped connection just
 * means the next reload (or reconnect) catches up. We give EventSource the board ids as query
 * params and let it manage the socket lifecycle.
 */
import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@/domain/realtime";

export interface UseRealtimeResult {
  /** User ids currently present on the subscribed board(s), derived from presence events. */
  presentUserIds: string[];
  /** True once the EventSource has opened. */
  connected: boolean;
}

/**
 * @param boardIds  boards to subscribe to (stable identity matters — pass a memoized array or
 *                  a primitive-joined key changes will reconnect).
 * @param onEvent   called for every authorized event (task/chat/presence). Keep it stable.
 */
export function useRealtime(
  boardIds: string[],
  onEvent?: (event: RealtimeEvent) => void,
): UseRealtimeResult {
  const [connected, setConnected] = useState(false);
  const [present, setPresent] = useState<Set<string>>(new Set());
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Stable subscription key so we only reconnect when the board set actually changes.
  const key = [...boardIds].sort().join(",");

  useEffect(() => {
    if (!key) {
      setConnected(false);
      return;
    }
    const params = new URLSearchParams();
    for (const id of key.split(",")) params.append("board", id);
    const es = new EventSource(`/api/stream?${params.toString()}`);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource retries automatically

    es.onmessage = (e) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(e.data) as RealtimeEvent;
      } catch {
        return;
      }
      if (event.type === "presence" && event.userId) {
        setPresent((prev) => {
          const next = new Set(prev);
          if (event.presence === "leave") next.delete(event.userId!);
          else next.add(event.userId!);
          return next;
        });
      }
      onEventRef.current?.(event);
    };

    return () => {
      es.close();
      setConnected(false);
      setPresent(new Set());
    };
  }, [key]);

  return { presentUserIds: [...present], connected };
}
