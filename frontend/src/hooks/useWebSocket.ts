/**
 * useWebSocket.ts
 *
 * Connects to the Sentinel /ws WebSocket endpoint.
 * Auto-reconnects with exponential backoff (max 30s).
 * Dispatches typed messages to registered handlers.
 *
 * Usage:
 *   const { connected } = useWebSocket({
 *     onNewEvent: (ev) => setEvents(prev => [ev, ...prev]),
 *     onStatsUpdate: (s) => setStats(s),
 *   });
 */
import { useEffect, useRef, useState, useCallback } from 'react';

export type WsEventPayload = {
  type: 'NEW_EVENT';
  id?: number;
  title: string;
  description?: string;
  url?: string;
  source?: string;
  crime_types?: string;
  zone_id?: string;
  zone?: string;
  severity?: string;
  published_at?: string;
};

export type WsStatsPayload = {
  type: 'STATS_UPDATE';
  total_24h: number;
  critical: number;
  warning: number;
};

export type WsAlertPayload = {
  type: 'ALERT';
  zone: string;
  message: string;
  severity: string;
};

export type WsMessage = WsEventPayload | WsStatsPayload | WsAlertPayload;

interface UseWebSocketOptions {
  onNewEvent?:    (ev: WsEventPayload)   => void;
  onStatsUpdate?: (s:  WsStatsPayload)   => void;
  onAlert?:       (a:  WsAlertPayload)   => void;
}

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${
  import.meta.env.VITE_API_BASE?.replace(/^https?:\/\//, '') ||
  window.location.hostname + ':8000'
}/ws`;

const MAX_BACKOFF = 30_000;

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [connected, setConnected] = useState(false);
  const wsRef      = useRef<WebSocket | null>(null);
  const backoffRef = useRef(1_000);       // start at 1s
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const optsRef    = useRef(options);
  optsRef.current  = options;             // always latest handlers without re-subscribing

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      backoffRef.current = 1_000;         // reset backoff on successful connect
      console.log('[WS] Connected to Sentinel backend');
    };

    ws.onmessage = (e) => {
      try {
        const msg: WsMessage = JSON.parse(e.data);
        switch (msg.type) {
          case 'NEW_EVENT':    optsRef.current.onNewEvent?.(msg);    break;
          case 'STATS_UPDATE': optsRef.current.onStatsUpdate?.(msg); break;
          case 'ALERT':        optsRef.current.onAlert?.(msg);        break;
          default:
            console.debug('[WS] Unknown message type:', (msg as any).type);
        }
      } catch (err) {
        console.warn('[WS] Failed to parse message:', e.data);
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose — handle reconnect there
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (!mountedRef.current) return;
      const delay = backoffRef.current;
      console.log(`[WS] Disconnected — reconnecting in ${delay / 1000}s`);
      timerRef.current = setTimeout(connect, delay);
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [connect]);

  return { connected };
}
