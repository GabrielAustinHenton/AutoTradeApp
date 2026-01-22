/**
 * Interactive Brokers Configuration
 *
 * These settings are tracked in git so you don't have to reconnect
 * after clearing localStorage.
 *
 * The IBKR Client Portal Gateway must be running at the specified URL.
 * Default: https://localhost:5000
 */

export const IBKR_CONFIG = {
  // Your IBKR account ID
  accountId: 'U24020322',

  // Client Portal Gateway URL (usually https://localhost:5000)
  baseUrl: 'https://localhost:5000',
};
