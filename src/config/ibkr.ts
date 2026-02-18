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
  apiKey: 'df0a99e3fcadd4b7682eb872cdcf9abfca75caec291ce842a2e6a2b8efe2484e',
};
