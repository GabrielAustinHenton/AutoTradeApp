/**
 * Alpaca Markets Configuration
 *
 * API keys are entered via Settings and stored in localStorage.
 * This file provides empty defaults so the app compiles cleanly
 * before keys are configured.
 *
 * Alpaca uses stateless API key auth — no gateway, no daily re-auth.
 * Paper and Live trading each have separate API keys.
 */

export const ALPACA_CONFIG = {
  // Paper trading API keys (from paper-api.alpaca.markets dashboard)
  paperKeyId: '',
  paperSecretKey: '',

  // Live trading API keys (from app.alpaca.markets dashboard)
  liveKeyId: '',
  liveSecretKey: '',
};
