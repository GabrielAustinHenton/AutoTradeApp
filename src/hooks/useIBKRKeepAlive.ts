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
// - Updates ibkrAuthenticated in the store so the UI can show a reconnect prompt
// ============================================================================

import { useEffect, useRef, useCallback } from 'react';
import { ibkr } from '../services/ibkr';
import { useStore } from '../store/useStore';

const TICKLE_INTERVAL = 55_000;      // 55 seconds
const AUTH_CHECK_INTERVAL = 300_000; // 5 minutes

export function useIBKRKeepAlive() {
  const ibkrConnected = useStore((s) => s.ibkrConnected);
  const setIbkrAuthenticated = useStore((s) => s.setIbkrAuthenticated);
  const tickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const authCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendTickle = useCallback(async () => {
    if (!ibkrConnected || !ibkr.isConfigured()) return;
    try {
      await ibkr.tickle();
    } catch {
      // Tickle failure is non-critical; auth check will catch real issues
    }
  }, [ibkrConnected]);

  const checkAuth = useCallback(async () => {
    if (!ibkrConnected || !ibkr.isConfigured()) return;
    try {
      const status = await ibkr.getAuthStatus();
      setIbkrAuthenticated(status.authenticated);
    } catch {
      setIbkrAuthenticated(false);
    }
  }, [ibkrConnected, setIbkrAuthenticated]);

  useEffect(() => {
    if (ibkrConnected) {
      // Check auth immediately on connect
      checkAuth();

      tickleRef.current = setInterval(sendTickle, TICKLE_INTERVAL);
      authCheckRef.current = setInterval(checkAuth, AUTH_CHECK_INTERVAL);

      // Also re-check auth when the tab becomes visible again (user returns to app)
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          checkAuth();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        if (tickleRef.current) clearInterval(tickleRef.current);
        if (authCheckRef.current) clearInterval(authCheckRef.current);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [ibkrConnected, sendTickle, checkAuth]);
}
