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

  // CORS proxy URL on Google Cloud VM
  baseUrl: 'http://136.114.200.145:5001',

  // API key for the CORS proxy
  apiKey: 'c5de3c5661fc680dc5b539e5751f22648411c971d5ecb8ce',
};
