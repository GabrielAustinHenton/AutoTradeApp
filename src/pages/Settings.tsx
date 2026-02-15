import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { ibkr } from '../services/ibkr';
import { canExecuteAutoTrade, executeAutoTrade } from '../services/autoTrader';
import { useAuth } from '../contexts/AuthContext';
import { saveToFirestore } from '../services/firestoreSync';
import type { Alert } from '../types';

export function Settings() {
  const { user, userProfile, logOut, updateUserProfile, isConfigured } = useAuth();
  const {
    ibkrConnected,
    ibkrAccountId,
    connectIBKR,
    disconnectIBKR,
    syncFromIBKR,
    alertsEnabled,
    soundEnabled,
    toggleAlerts,
    toggleSound,
    tradingMode,
    setTradingMode,
    paperPortfolio,
    resetPaperPortfolio,
    resetTradingRules,
    autoTradeConfig,
    updateAutoTradeConfig,
    tradingRules,
    addAlert,
    autoTradeExecutions,
  } = useStore();

  const [gatewayUrl, setGatewayUrl] = useState('https://localhost:5000');
  const [accountId, setAccountId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<{
    authenticated: boolean;
    connected: boolean;
  } | null>(null);
  const [testingAutoTrade, setTestingAutoTrade] = useState(false);
  const [autoTradeTestResult, setAutoTradeTestResult] = useState<string | null>(null);

  // Get rules that have auto-trade enabled
  const autoTradeRules = tradingRules.filter((r) => r.autoTrade && r.enabled && r.ruleType === 'pattern');

  // Test auto-trade function
  const handleTestAutoTrade = async () => {
    if (autoTradeRules.length === 0) {
      setAutoTradeTestResult('No rules have auto-trade enabled. Enable auto-trade on a rule in the Rules page first.');
      return;
    }

    setTestingAutoTrade(true);
    setAutoTradeTestResult(null);

    // Pick the first auto-trade enabled rule
    const testRule = autoTradeRules[0];

    // Check if we can execute
    const canExecute = canExecuteAutoTrade(testRule, autoTradeConfig);
    if (!canExecute.allowed) {
      setAutoTradeTestResult(`Cannot execute: ${canExecute.reason}`);
      setTestingAutoTrade(false);
      return;
    }

    // Create a test alert
    const testAlert: Alert = {
      id: crypto.randomUUID(),
      type: 'pattern',
      symbol: testRule.symbol,
      message: `TEST: ${testRule.pattern} pattern on ${testRule.symbol}`,
      signal: testRule.type,
      pattern: testRule.pattern,
      ruleId: testRule.id,
      confidence: 0.85,
      timestamp: new Date(),
      read: false,
      dismissed: false,
    };

    // Add the alert
    addAlert(testAlert);

    try {
      // Execute the auto-trade
      const execution = await executeAutoTrade(testAlert, testRule, tradingMode, autoTradeConfig);

      if (execution.status === 'executed') {
        setAutoTradeTestResult(
          `Success! ${execution.type.toUpperCase()} ${execution.shares} shares of ${execution.symbol} at $${execution.price.toFixed(2)} (Total: $${execution.total.toFixed(2)})`
        );
      } else {
        setAutoTradeTestResult(`Trade failed: ${execution.error}`);
      }
    } catch (err) {
      setAutoTradeTestResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    setTestingAutoTrade(false);
  };

  // Load existing config on mount
  useEffect(() => {
    const config = ibkr.loadConfig();
    if (config) {
      setGatewayUrl(config.gatewayUrl);
      setAccountId(config.accountId);
      if (config.apiKey) setApiKey(config.apiKey);
    }
  }, []);

  // Check auth status when connected
  useEffect(() => {
    if (ibkrConnected) {
      checkAuthStatus();
    }
  }, [ibkrConnected]);

  const checkAuthStatus = async () => {
    try {
      const status = await ibkr.getAuthStatus();
      setAuthStatus({
        authenticated: status.authenticated,
        connected: status.connected,
      });
    } catch (err) {
      console.error('Failed to get auth status:', err);
      setAuthStatus(null);
    }
  };

  const handleConnect = async () => {
    setError(null);
    setSuccess(null);
    setConnecting(true);

    try {
      // Configure IBKR
      connectIBKR({
        gatewayUrl,
        accountId,
        apiKey: apiKey || undefined,
      });

      // Test connection by checking auth status
      const status = await ibkr.getAuthStatus();

      if (!status.authenticated) {
        setError('Not authenticated. Please log in to the IB Gateway web interface first.');
        disconnectIBKR();
        return;
      }

      setAuthStatus({
        authenticated: status.authenticated,
        connected: status.connected,
      });

      setSuccess(`Connected to Interactive Brokers! Account: ${accountId}`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Connection failed: ${err.message}. Make sure IB Gateway is running.`
          : 'Failed to connect'
      );
      disconnectIBKR();
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnectIBKR();
    setSuccess(null);
    setError(null);
    setAuthStatus(null);
  };

  const handleSync = async () => {
    setError(null);
    setSyncing(true);

    try {
      await syncFromIBKR();
      setSuccess('Portfolio synced successfully!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="text-white max-w-4xl">
      <h1 className="text-2xl md:text-3xl font-bold mb-6 md:mb-8">Settings</h1>

      {/* Trading Mode */}
      <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-4 md:mb-6">
        <h2 className="text-lg md:text-xl font-semibold mb-4 md:mb-6">Trading Mode</h2>

        <div className="flex flex-col md:flex-row gap-3 md:gap-4 mb-4 md:mb-6">
          <button
            onClick={() => setTradingMode('paper')}
            className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
              tradingMode === 'paper'
                ? 'border-emerald-500 bg-emerald-900/30'
                : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
            }`}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xl md:text-2xl">📝</span>
              <span className="font-semibold text-base md:text-lg">Paper Trading</span>
            </div>
            <p className="text-sm text-slate-400">
              Practice trading with simulated money. No real money at risk.
            </p>
          </button>

          <button
            onClick={() => setTradingMode('live')}
            disabled={!ibkrConnected}
            className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
              tradingMode === 'live'
                ? 'border-red-500 bg-red-900/30'
                : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
            } ${!ibkrConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xl md:text-2xl">💰</span>
              <span className="font-semibold text-base md:text-lg">Live Trading</span>
            </div>
            <p className="text-sm text-slate-400">
              {ibkrConnected
                ? 'Trade with real money via IBKR. Use caution!'
                : 'Connect to IBKR below to enable live trading.'}
            </p>
          </button>
        </div>

        {tradingMode === 'paper' && (
          <div className="p-3 md:p-4 bg-slate-700/50 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium">Paper Portfolio</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 text-sm mb-4">
              <div>
                <span className="text-slate-400">Cash Balance</span>
                <p className="font-semibold text-emerald-400">
                  ${paperPortfolio.cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Positions</span>
                <p className="font-semibold">{paperPortfolio.positions.length}</p>
              </div>
              <div>
                <span className="text-slate-400">Total Trades</span>
                <p className="font-semibold">{paperPortfolio.trades.length}</p>
              </div>
            </div>
            <div className="border-t border-slate-600 pt-4">
              <p className="text-sm text-slate-400 mb-2">Reset portfolio with custom starting balance:</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => resetPaperPortfolio(5)}
                  className="px-2 md:px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-sm"
                >
                  $5
                </button>
                <button
                  onClick={() => resetPaperPortfolio(100)}
                  className="px-2 md:px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-sm"
                >
                  $100
                </button>
                <button
                  onClick={() => resetPaperPortfolio(1000)}
                  className="px-2 md:px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded text-sm"
                >
                  $1,000
                </button>
                <button
                  onClick={() => resetPaperPortfolio(25000)}
                  className="px-2 md:px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-sm"
                >
                  $25,000 (PDT)
                </button>
              </div>
              <p className="text-xs text-red-400 mt-2">Warning: This will clear all positions and trade history</p>
            </div>

            {/* Reset Trading Rules */}
            <div className="border-t border-slate-600 pt-4 mt-4">
              <h3 className="font-semibold mb-2">Trading Rules</h3>
              <p className="text-sm text-slate-400 mb-2">
                Reset all trading rules to defaults (long-only BUY rules for bullish patterns).
              </p>
              <button
                onClick={() => {
                  if (confirm('Reset all trading rules to defaults? This will delete your custom rules and create new BUY rules for bullish patterns.')) {
                    resetTradingRules();
                  }
                }}
                className="px-3 md:px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm"
              >
                Reset Rules
              </button>
              <p className="text-xs text-purple-400 mt-2">
                Current rules: {tradingRules.length} total
              </p>
            </div>
          </div>
        )}

        {tradingMode === 'live' && (
          <div className="p-4 bg-red-900/20 border border-red-700 rounded-lg">
            <div className="flex items-center gap-2 text-red-400">
              <span>⚠️</span>
              <span className="font-medium">Live Trading Active</span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              All trades will be executed with real money through your IBKR account.
            </p>
          </div>
        )}
      </div>

      {/* Auto-Trading */}
      <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-4 md:mb-6">
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <div>
            <h2 className="text-lg md:text-xl font-semibold">Auto-Trading</h2>
            <p className="text-slate-400 text-sm mt-1">
              Automatically execute trades when pattern rules trigger
            </p>
          </div>
          <button
            onClick={() => updateAutoTradeConfig({ enabled: !autoTradeConfig.enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoTradeConfig.enabled ? 'bg-emerald-600' : 'bg-slate-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoTradeConfig.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {autoTradeConfig.enabled && tradingMode === 'live' && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            ⚠️ Auto-trading is enabled in LIVE mode. Real trades will be executed automatically!
          </div>
        )}

        <div className="space-y-3 md:space-y-4">
          <div className="flex items-center justify-between p-3 md:p-4 bg-slate-700/50 rounded-lg">
            <div>
              <h3 className="font-medium text-sm md:text-base">Max Trades Per Day</h3>
              <p className="text-xs md:text-sm text-slate-400 mt-1">
                Maximum number of auto-trades allowed per day
              </p>
            </div>
            <input
              type="number"
              value={autoTradeConfig.maxTradesPerDay}
              onChange={(e) => updateAutoTradeConfig({ maxTradesPerDay: parseInt(e.target.value) || 1 })}
              min="1"
              max="100"
              className="w-20 px-3 py-1 bg-slate-700 border border-slate-600 rounded-lg text-center focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center justify-between p-3 md:p-4 bg-slate-700/50 rounded-lg">
            <div>
              <h3 className="font-medium text-sm md:text-base">Max Position Size</h3>
              <p className="text-xs md:text-sm text-slate-400 mt-1">
                Maximum shares per auto-trade
              </p>
            </div>
            <input
              type="number"
              value={autoTradeConfig.maxPositionSize}
              onChange={(e) => updateAutoTradeConfig({ maxPositionSize: parseInt(e.target.value) || 1 })}
              min="1"
              max="10000"
              className="w-20 px-3 py-1 bg-slate-700 border border-slate-600 rounded-lg text-center focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center justify-between p-3 md:p-4 bg-slate-700/50 rounded-lg">
            <div>
              <h3 className="font-medium text-sm md:text-base">Trading Hours Only</h3>
              <p className="text-xs md:text-sm text-slate-400 mt-1">
                Only execute during market hours (9:30 AM - 4:00 PM ET)
              </p>
            </div>
            <button
              onClick={() => updateAutoTradeConfig({ tradingHoursOnly: !autoTradeConfig.tradingHoursOnly })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoTradeConfig.tradingHoursOnly ? 'bg-emerald-600' : 'bg-slate-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoTradeConfig.tradingHoursOnly ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Test Auto-Trade */}
          <div className="p-3 md:p-4 bg-slate-700/50 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-medium text-sm md:text-base">Test Auto-Trade</h3>
                <p className="text-xs md:text-sm text-slate-400 mt-1">
                  Simulate a pattern detection to test auto-trading
                </p>
              </div>
              <button
                onClick={handleTestAutoTrade}
                disabled={testingAutoTrade || !autoTradeConfig.enabled}
                className="px-3 md:px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium text-sm md:text-base transition-colors"
              >
                {testingAutoTrade ? 'Testing...' : 'Run Test'}
              </button>
            </div>

            {autoTradeRules.length > 0 && (
              <p className="text-xs text-slate-500 mb-2">
                Will test with: {autoTradeRules[0].name} ({autoTradeRules[0].symbol})
              </p>
            )}

            {autoTradeTestResult && (
              <div className={`p-3 rounded-lg text-sm ${
                autoTradeTestResult.startsWith('Success')
                  ? 'bg-emerald-900/30 border border-emerald-700 text-emerald-300'
                  : 'bg-red-900/30 border border-red-700 text-red-300'
              }`}>
                {autoTradeTestResult}
              </div>
            )}

            {!autoTradeConfig.enabled && (
              <p className="text-sm text-amber-400">
                Enable auto-trading above to run a test.
              </p>
            )}
          </div>
        </div>

        {/* Execution History */}
        {autoTradeExecutions.length > 0 && (
          <div className="mt-6">
            <h3 className="font-medium mb-3">Execution History</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="pb-2">Time</th>
                    <th className="pb-2">Rule</th>
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Shares</th>
                    <th className="pb-2">Price</th>
                    <th className="pb-2">Total</th>
                    <th className="pb-2">Mode</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {autoTradeExecutions.slice(0, 20).map((exec) => (
                    <tr key={exec.id} className="border-b border-slate-700/50">
                      <td className="py-2 text-slate-400">
                        {new Date(exec.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2">{exec.ruleName.substring(0, 20)}</td>
                      <td className="py-2 font-medium">{exec.symbol}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          exec.type === 'buy'
                            ? 'bg-emerald-900 text-emerald-300'
                            : 'bg-red-900 text-red-300'
                        }`}>
                          {exec.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2">{exec.shares}</td>
                      <td className="py-2">${exec.price.toFixed(2)}</td>
                      <td className="py-2">${exec.total.toFixed(2)}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          exec.mode === 'paper'
                            ? 'bg-amber-900 text-amber-300'
                            : 'bg-blue-900 text-blue-300'
                        }`}>
                          {exec.mode.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          exec.status === 'executed'
                            ? 'bg-emerald-900 text-emerald-300'
                            : exec.status === 'failed'
                            ? 'bg-red-900 text-red-300'
                            : 'bg-slate-700 text-slate-300'
                        }`}>
                          {exec.status.toUpperCase()}
                        </span>
                        {exec.error && (
                          <span className="ml-2 text-red-400 text-xs">{exec.error}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {autoTradeExecutions.length > 20 && (
                <p className="text-center text-slate-500 mt-3 text-xs">
                  Showing 20 of {autoTradeExecutions.length} executions
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* IBKR Connection */}
      <div className="bg-slate-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">Interactive Brokers</h2>
            <p className="text-slate-400 text-sm mt-1">
              Connect to your IBKR account via Client Portal Gateway
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                ibkrConnected ? 'bg-emerald-500' : 'bg-slate-500'
              }`}
            />
            <span className="text-sm text-slate-400">
              {ibkrConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>

        {/* Setup Instructions - Tabs for Local vs Web */}
        <div className="mb-6 p-4 bg-slate-700/50 rounded-lg">
          <h3 className="font-medium mb-3">Setup Instructions</h3>

          <div className="space-y-4">
            {/* Local Development */}
            <div className="bg-slate-600/30 rounded-lg p-3">
              <h4 className="text-sm font-medium text-emerald-400 mb-2">Local Development</h4>
              <ol className="text-sm text-slate-400 space-y-1 list-decimal list-inside">
                <li>
                  Download the{' '}
                  <a href="https://www.interactivebrokers.com/en/trading/ib-api.php" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                    IB Client Portal Gateway
                  </a>
                </li>
                <li>Run the gateway locally (starts on localhost:5000)</li>
                <li>Log in through the gateway's web interface</li>
                <li>Set Gateway URL to <code className="text-emerald-300">https://localhost:5000</code></li>
              </ol>
            </div>

            {/* Web / Remote via Google Cloud Free VM */}
            <div className="bg-slate-600/30 rounded-lg p-3">
              <h4 className="text-sm font-medium text-blue-400 mb-2">Web / Phone Access (Google Cloud Free VM)</h4>
              <ol className="text-sm text-slate-400 space-y-1 list-decimal list-inside">
                <li>
                  Install the{' '}
                  <a href="https://cloud.google.com/sdk/docs/install" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                    gcloud CLI
                  </a>
                  {' '}and log in with your Google account
                </li>
                <li>
                  Run <code className="text-blue-300">./server/deploy-gce.sh</code> to create a free VM
                </li>
                <li>SSH into the VM and run the setup script (printed after deploy)</li>
                <li>
                  Log into IBKR at <code className="text-blue-300">https://VM_IP:5000</code>
                </li>
                <li>Enter the proxy URL and API key below</li>
              </ol>
              <p className="text-xs text-amber-400 mt-2">
                Uses Google Cloud's always-free e2-micro VM. The proxy keeps your IBKR session alive 24/7 automatically.
              </p>
            </div>
          </div>
        </div>

        {/* Connection Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Gateway / Proxy URL
            </label>
            <input
              type="text"
              value={gatewayUrl}
              onChange={(e) => setGatewayUrl(e.target.value)}
              placeholder="https://localhost:5000 or http://your-server:5001"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-emerald-500"
              disabled={ibkrConnected}
            />
            <p className="text-xs text-slate-500 mt-1">
              Local: https://localhost:5000 | Remote: http://your-server:5001 (CORS proxy)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Account ID
            </label>
            <input
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="U1234567"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-emerald-500"
              disabled={ibkrConnected}
            />
            <p className="text-xs text-slate-500 mt-1">
              Your IBKR account ID (starts with U, DU, or similar)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Proxy API Key
              <span className="text-slate-500 font-normal ml-2">(for remote/web connections)</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Leave blank for local development"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-emerald-500"
              disabled={ibkrConnected}
            />
            <p className="text-xs text-slate-500 mt-1">
              The PROXY_API_KEY you set when starting the CORS proxy server. Not needed for local dev.
            </p>
          </div>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 p-3 bg-emerald-900/30 border border-emerald-700 rounded-lg text-emerald-300">
            {success}
          </div>
        )}

        {/* Auth Status */}
        {authStatus && ibkrConnected && (
          <div className="mt-4 p-4 bg-slate-700/50 rounded-lg">
            <h3 className="font-medium mb-2">Connection Status</h3>
            <div className="flex items-center gap-4 text-sm">
              <span
                className={`px-2 py-1 rounded ${
                  authStatus.authenticated
                    ? 'bg-emerald-900/50 text-emerald-300'
                    : 'bg-red-900/50 text-red-300'
                }`}
              >
                {authStatus.authenticated ? 'Authenticated' : 'Not Authenticated'}
              </span>
              <span
                className={`px-2 py-1 rounded ${
                  authStatus.connected
                    ? 'bg-emerald-900/50 text-emerald-300'
                    : 'bg-amber-900/50 text-amber-300'
                }`}
              >
                {authStatus.connected ? 'Gateway Connected' : 'Gateway Disconnected'}
              </span>
              <span className="text-slate-400">Account: {ibkrAccountId}</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex gap-3">
          {!ibkrConnected ? (
            <button
              onClick={handleConnect}
              disabled={connecting || !accountId}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          ) : (
            <>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 rounded-lg font-medium transition-colors"
              >
                {syncing ? 'Syncing...' : 'Sync Portfolio'}
              </button>
              <button
                onClick={checkAuthStatus}
                className="px-6 py-2 bg-slate-600 hover:bg-slate-500 rounded-lg font-medium transition-colors"
              >
                Check Status
              </button>
              <button
                onClick={handleDisconnect}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-colors"
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>

      {/* Alert Settings */}
      <div className="bg-slate-800 rounded-xl p-6 mb-6">
        <h2 className="text-xl font-semibold mb-6">Alerts & Notifications</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
            <div>
              <h3 className="font-medium">Pattern Alerts</h3>
              <p className="text-sm text-slate-400 mt-1">
                Get notified when candlestick patterns are detected
              </p>
            </div>
            <button
              onClick={toggleAlerts}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                alertsEnabled ? 'bg-emerald-600' : 'bg-slate-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  alertsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
            <div>
              <h3 className="font-medium">Sound Notifications</h3>
              <p className="text-sm text-slate-400 mt-1">
                Play sound when alerts are triggered
              </p>
            </div>
            <button
              onClick={toggleSound}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                soundEnabled ? 'bg-emerald-600' : 'bg-slate-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  soundEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* User Account */}
      {isConfigured && user && (
        <div className="bg-slate-800 rounded-xl p-6 mb-6">
          <h2 className="text-xl font-semibold mb-6">Your Account</h2>

          <div className="flex items-center gap-4 mb-6 p-4 bg-slate-700/50 rounded-lg">
            <div className="w-14 h-14 rounded-full bg-emerald-600 flex items-center justify-center text-2xl font-bold">
              {(userProfile?.displayName || user.email || '?')[0].toUpperCase()}
            </div>
            <div>
              <p className="text-lg font-medium">{userProfile?.displayName || 'User'}</p>
              <p className="text-sm text-slate-400">{user.email}</p>
              <p className="text-xs text-slate-500 mt-1">
                Member since {userProfile?.createdAt ? new Date(userProfile.createdAt).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {/* Sync to Cloud */}
            <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
              <div>
                <h3 className="font-medium">Sync Data to Cloud</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Save your portfolio, trades, and settings to Firestore for access on any device
                </p>
              </div>
              <button
                onClick={() => saveToFirestore(user.uid)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
              >
                Sync Now
              </button>
            </div>

            {/* Save IBKR settings to user profile */}
            {ibkrConnected && ibkrAccountId && (
              <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
                <div>
                  <h3 className="font-medium">Save IBKR Config to Profile</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    Store your IBKR account ID ({ibkrAccountId}) in your user profile for quick reconnection
                  </p>
                </div>
                <button
                  onClick={() => updateUserProfile({
                    ibkrAccountId,
                    ibkrGatewayUrl: gatewayUrl,
                  })}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition-colors"
                >
                  Save
                </button>
              </div>
            )}

            {/* Sign Out */}
            <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
              <div>
                <h3 className="font-medium">Sign Out</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Sign out of your account. Your data is saved locally and in the cloud.
                </p>
              </div>
              <button
                onClick={logOut}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* About Section */}
      <div className="bg-slate-800 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">About</h2>
        <div className="text-slate-400 text-sm space-y-2">
          <p>TradeApp - Stock Trading & Portfolio Management</p>
          <p>Built with React, TypeScript, and Interactive Brokers API</p>
          <p className="pt-2">
            <a
              href="https://www.interactivebrokers.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline"
            >
              Powered by Interactive Brokers
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
