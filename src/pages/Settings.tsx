import { useState } from 'react';
import { useStore } from '../store/useStore';
import { alpaca } from '../services/alpaca';
import { canExecuteAutoTrade, executeAutoTrade } from '../services/autoTrader';
import { useAuth } from '../contexts/AuthContext';
import { saveToFirestore } from '../services/firestoreSync';
import type { Alert } from '../types';

export function Settings() {
  const { user, userProfile, logOut, updateUserProfile, isConfigured } = useAuth();
  const {
    alpacaConnected,
    connectAlpaca,
    disconnectAlpaca,
    syncFromAlpaca,
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

  // Alpaca connection form state
  const [paperKeyId, setPaperKeyId] = useState(() => alpaca.loadConfig()?.isPaper !== false ? (alpaca.loadConfig()?.keyId ?? '') : '');
  const [paperSecretKey, setPaperSecretKey] = useState(() => alpaca.loadConfig()?.isPaper !== false ? (alpaca.loadConfig()?.secretKey ?? '') : '');
  const [liveKeyId, setLiveKeyId] = useState(() => alpaca.loadConfig()?.isPaper === false ? (alpaca.loadConfig()?.keyId ?? '') : '');
  const [liveSecretKey, setLiveSecretKey] = useState(() => alpaca.loadConfig()?.isPaper === false ? (alpaca.loadConfig()?.secretKey ?? '') : '');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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

  const handleConnectPaper = async () => {
    if (!paperKeyId || !paperSecretKey) {
      setError('Enter both Paper Key ID and Secret Key.');
      return;
    }
    setError(null);
    setSuccess(null);
    setConnecting(true);
    try {
      const config = { keyId: paperKeyId, secretKey: paperSecretKey, isPaper: true };
      alpaca.configure(config);
      // Verify by fetching account
      await alpaca.getAccount();
      connectAlpaca(config);
      await syncFromAlpaca();
      setSuccess('Connected to Alpaca Paper Trading!');
    } catch (err) {
      alpaca.clearConfig();
      setError(err instanceof Error ? `Connection failed: ${err.message}` : 'Failed to connect. Check your API keys.');
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectLive = async () => {
    if (!liveKeyId || !liveSecretKey) {
      setError('Enter both Live Key ID and Secret Key.');
      return;
    }
    setError(null);
    setSuccess(null);
    setConnecting(true);
    try {
      const config = { keyId: liveKeyId, secretKey: liveSecretKey, isPaper: false };
      alpaca.configure(config);
      await alpaca.getAccount();
      connectAlpaca(config);
      await syncFromAlpaca();
      setSuccess('Connected to Alpaca Live Trading!');
    } catch (err) {
      alpaca.clearConfig();
      setError(err instanceof Error ? `Connection failed: ${err.message}` : 'Failed to connect. Check your API keys.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnectAlpaca();
    setSuccess(null);
    setError(null);
  };

  const handleSync = async () => {
    setError(null);
    setSyncing(true);
    try {
      await syncFromAlpaca();
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
            disabled={!alpacaConnected}
            className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
              tradingMode === 'live'
                ? 'border-red-500 bg-red-900/30'
                : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
            } ${!alpacaConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xl md:text-2xl">💰</span>
              <span className="font-semibold text-base md:text-lg">Live Trading</span>
            </div>
            <p className="text-sm text-slate-400">
              {alpacaConnected
                ? 'Trade with real money via Alpaca. Use caution!'
                : 'Connect Alpaca Live keys below to enable live trading.'}
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
              All trades will be executed with real money through your Alpaca account.
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

      {/* Alpaca Connection */}
      <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-4 md:mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg md:text-xl font-semibold">Alpaca Markets</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              API key auth — no daily re-login required
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${alpacaConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
            <span className={`text-sm font-medium ${alpacaConnected ? 'text-emerald-400' : 'text-slate-400'}`}>
              {alpacaConnected ? `Connected (${alpaca.isPaper() ? 'Paper' : 'Live'})` : 'Not connected'}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-emerald-900/30 border border-emerald-700 rounded-lg text-emerald-300 text-sm">
            {success}
          </div>
        )}

        {/* If already connected, show sync/disconnect buttons */}
        {alpacaConnected ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 rounded-lg text-sm font-medium transition-colors"
            >
              {syncing ? 'Syncing...' : 'Sync Portfolio'}
            </button>
            <button
              onClick={handleDisconnect}
              className="px-4 py-1.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-medium transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Paper Trading Keys */}
            <div className="p-4 bg-slate-700/50 rounded-lg">
              <h3 className="font-medium mb-1">Paper Trading Keys</h3>
              <p className="text-xs text-slate-400 mb-3">
                From <span className="text-slate-300">app.alpaca.markets</span> → Paper Trading → API Keys
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={paperKeyId}
                  onChange={(e) => setPaperKeyId(e.target.value.trim())}
                  placeholder="Paper Key ID (e.g. PKXXXXXXXXXXXXXXXX)"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="password"
                  value={paperSecretKey}
                  onChange={(e) => setPaperSecretKey(e.target.value.trim())}
                  placeholder="Paper Secret Key"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                onClick={handleConnectPaper}
                disabled={connecting || !paperKeyId || !paperSecretKey}
                className="mt-3 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                {connecting ? 'Connecting...' : 'Connect Paper'}
              </button>
            </div>

            {/* Live Trading Keys */}
            <div className="p-4 bg-slate-700/50 rounded-lg">
              <h3 className="font-medium mb-1">Live Trading Keys</h3>
              <p className="text-xs text-slate-400 mb-3">
                From <span className="text-slate-300">app.alpaca.markets</span> → Live Trading → API Keys (requires funded account)
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={liveKeyId}
                  onChange={(e) => setLiveKeyId(e.target.value.trim())}
                  placeholder="Live Key ID (e.g. AKXXXXXXXXXXXXXXXX)"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
                <input
                  type="password"
                  value={liveSecretKey}
                  onChange={(e) => setLiveSecretKey(e.target.value.trim())}
                  placeholder="Live Secret Key"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <button
                onClick={handleConnectLive}
                disabled={connecting || !liveKeyId || !liveSecretKey}
                className="mt-3 px-4 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                {connecting ? 'Connecting...' : 'Connect Live'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Alert Settings */}
      <div className="bg-slate-800 rounded-xl p-6 mb-6">
        <h2 className="text-xl font-semibold mb-2">Alerts & Notifications</h2>
        <p className="text-sm text-slate-400 mb-6">
          These are <span className="text-white font-medium">manual trading signals only</span> — pop-up toasts that appear when the scanner detects a candlestick pattern on your watchlist. They do <span className="text-white font-medium">not</span> place trades automatically. Auto-trading is controlled separately under <span className="text-white font-medium">Auto-Trade Settings</span> above.
        </p>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
            <div>
              <h3 className="font-medium">Pattern Notifications</h3>
              <p className="text-sm text-slate-400 mt-1">
                Show on-screen toast notifications when buy/sell signals are detected.
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
                Play a sound when a signal alert fires. Off by default.
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
          <p>AutoTrader - Stock Trading & Portfolio Management</p>
          <p>Built with React, TypeScript, and Alpaca Markets API</p>
          <p className="pt-2">
            <a
              href="https://alpaca.markets"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline"
            >
              Powered by Alpaca Markets
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
