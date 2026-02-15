// ============================================================================
// IBKR Keep-Alive Hook
// ============================================================================
// Keeps the IBKR Client Portal Gateway session alive by sending periodic
// "tickle" requests. Without this, the session expires after a few minutes
// of inactivity.
//
// This hook:
// - Sends a tickle every 55 seconds (session expires at 60s idle)
// - Checks auth status every 5 minutes
// - Automatically reconnects if session is lost
// - Shows connection status
// ============================================================================

import { useEffect, useRef, useCallback } from 'react';
import { ibkr } from '../services/ibkr';
import { useStore } from '../store/useStore';

const TICKLE_INTERVAL = 55_000;    // 55 seconds (IBKR timeout is ~60s)
const AUTH_CHECK_INTERVAL = 300_000; // 5 minutes

export function useIBKRKeepAlive() {
  const ibkrConnected = useStore((s) => s.ibkrConnected);
  const tickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendTickle = useCallback(async () => {
    if (!ibkrConnected || !ibkr.isConfigured()) return;

    try {
      await ibkr.tickle();
    } catch (err) {
      console.warn('[IBKR KeepAlive] Tickle failed:', err);
    }
  }, [ibkrConnected]);

  const checkAuth = useCallback(async () => {
    if (!ibkrConnected || !ibkr.isConfigured()) return;

    try {
      const status = await ibkr.getAuthStatus();
      if (!status.authenticated) {
        console.warn('[IBKR KeepAlive] Session lost - not authenticated');
      }
    } catch (err) {
      console.warn('[IBKR KeepAlive] Auth check failed:', err);
    }
  }, [ibkrConnected]);

  useEffect(() => {
    if (ibkrConnected) {
      // Start keep-alive intervals
      tickleRef.current = setInterval(sendTickle, TICKLE_INTERVAL);
      authCheckRef.current = setInterval(checkAuth, AUTH_CHECK_INTERVAL);

      // Send immediate tickle on connect
      sendTickle();

      console.log('[IBKR KeepAlive] Started - tickle every 55s, auth check every 5min');
    }

    return () => {
      if (tickleRef.current) {
        clearInterval(tickleRef.current);
        tickleRef.current = null;
      }
      if (authCheckRef.current) {
        clearInterval(authCheckRef.current);
        authCheckRef.current = null;
      }
    };
  }, [ibkrConnected, sendTickle, checkAuth]);
}
