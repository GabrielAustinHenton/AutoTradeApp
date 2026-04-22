import { useState } from 'react';
import { useStore } from '../store/useStore';
import { alpaca } from '../services/alpaca';
import { resetOrbScanner } from '../services/orbScanner';
import { saveAlpacaCredsToFirestore } from '../services/firestoreSync';
import { useAuth } from '../contexts/AuthContext';

export function Settings() {
  const { user, userProfile, logOut, isConfigured } = useAuth();
  const {
    alpacaPaperConnected,
    alpacaLiveConnected,
    connectAlpacaPaper,
    connectAlpacaLive,
    disconnectAlpacaPaper,
    disconnectAlpacaLive,
    syncFromAlpaca,
    tradingMode,
    setTradingMode,
    paperPortfolio,
    setPaperStartingBalance,
    autoTradeConfig,
    updateAutoTradeConfig,
    marketRegime,
    updateMarketRegime,
  } = useStore();

  const [startingBalanceInput, setStartingBalanceInput] = useState(
    String(paperPortfolio.startingBalance ?? 100000)
  );

  const [paperKeyId, setPaperKeyId] = useState(alpaca.getPaperKeyId());
  const [paperSecret, setPaperSecret] = useState('');
  const [liveKeyId, setLiveKeyId] = useState(alpaca.getLiveKeyId());
  const [liveSecret, setLiveSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleConnectPaper = async () => {
    if (!paperKeyId || !paperSecret) { setError('Enter both Paper Key ID and Secret Key.'); return; }
    setError(null); setSuccess(null); setConnecting(true);
    try {
      alpaca.configurePaper(paperKeyId, paperSecret);
      await alpaca.getAccount(true);
      connectAlpacaPaper(paperKeyId, paperSecret);
      if (user) saveAlpacaCredsToFirestore(user.uid, 'paper', { keyId: paperKeyId, secretKey: paperSecret });
      resetOrbScanner();
      setPaperSecret('');
      if (tradingMode === 'paper') await syncFromAlpaca().catch(() => {});
      setSuccess('Paper account connected!');
    } catch (err) {
      alpaca.clearPaper();
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg.includes('401') ? 'Invalid paper API keys.' : `Connection failed: ${msg}`);
    } finally { setConnecting(false); }
  };

  const handleConnectLive = async () => {
    if (!liveKeyId || !liveSecret) { setError('Enter both Live Key ID and Secret Key.'); return; }
    setError(null); setSuccess(null); setConnecting(true);
    try {
      alpaca.configureLive(liveKeyId, liveSecret);
      await alpaca.getAccount(false);
      connectAlpacaLive(liveKeyId, liveSecret);
      if (user) saveAlpacaCredsToFirestore(user.uid, 'live', { keyId: liveKeyId, secretKey: liveSecret });
      setLiveSecret('');
      if (tradingMode === 'live') await syncFromAlpaca().catch(() => {});
      setSuccess('Live account connected! Auto-trading disabled by default.');
    } catch (err) {
      alpaca.clearLive();
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg.includes('401') ? 'Invalid live API keys.' : `Connection failed: ${msg}`);
    } finally { setConnecting(false); }
  };

  const handleSync = async () => {
    setError(null); setSuccess(null); setSyncing(true);
    try {
      await syncFromAlpaca();
      setSuccess('Portfolio synced!');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally { setSyncing(false); }
  };

  return (
    <div className="text-white max-w-3xl">
      <h1 className="text-2xl md:text-3xl font-bold mb-6">Settings</h1>

      {/* Trading Mode */}
      <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-4">
        <h2 className="text-lg font-semibold mb-4">Trading Mode</h2>
        <div className="flex gap-3">
          <button
            onClick={() => setTradingMode('paper')}
            className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
              tradingMode === 'paper' ? 'border-emerald-500 bg-emerald-900/30' : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
            }`}
          >
            <p className="font-semibold">Paper Trading</p>
            <p className="text-sm text-slate-400 mt-1">Simulated — no real money</p>
          </button>
          <button
            onClick={() => setTradingMode('live')}
            disabled={!alpacaLiveConnected}
            className={`flex-1 p-4 rounded-lg border-2 transition-colors ${
              tradingMode === 'live' ? 'border-red-500 bg-red-900/30' : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
            } ${!alpacaLiveConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <p className="font-semibold">Live Trading</p>
            <p className="text-sm text-slate-400 mt-1">
              {alpacaLiveConnected ? 'Real money via Alpaca' : 'Connect live account first'}
            </p>
          </button>
        </div>

        {tradingMode === 'paper' && (
          <div className="mt-4 p-4 bg-slate-700/50 rounded-lg">
            <div className="flex items-center gap-3">
              <p className="text-sm text-slate-400">P&L Baseline:</p>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  value={startingBalanceInput}
                  onChange={(e) => setStartingBalanceInput(e.target.value)}
                  className="w-28 bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
                  min="1"
                />
                <button
                  onClick={() => { const val = parseFloat(startingBalanceInput); if (!isNaN(val) && val > 0) setPaperStartingBalance(val); }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition-colors"
                >
                  Set
                </button>
              </div>
            </div>
          </div>
        )}

        {tradingMode === 'live' && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-700 rounded-lg text-sm text-red-300">
            All trades use real money through your Alpaca account.
          </div>
        )}
      </div>

      {/* Alpaca Connection */}
      <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-4">
        <h2 className="text-lg font-semibold mb-1">Alpaca Markets</h2>
        <p className="text-slate-400 text-sm mb-4">Paper and live accounts are completely separate.</p>

        {error && <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">{error}</div>}
        {success && <div className="mb-4 p-3 bg-emerald-900/30 border border-emerald-700 rounded-lg text-emerald-300 text-sm">{success}</div>}

        <div className="space-y-4">
          {/* Paper */}
          <div className={`p-4 rounded-lg border ${alpacaPaperConnected ? 'bg-emerald-900/20 border-emerald-700' : 'bg-slate-700/50 border-slate-600'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Paper Trading</h3>
                {tradingMode === 'paper' && <span className="px-1.5 py-0.5 bg-emerald-500/20 border border-emerald-500/50 rounded text-xs text-emerald-400">Active</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${alpacaPaperConnected ? 'bg-emerald-500' : 'bg-slate-500'}`} />
                <span className={`text-xs ${alpacaPaperConnected ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {alpacaPaperConnected ? 'Connected' : 'Not connected'}
                </span>
              </div>
            </div>
            {alpacaPaperConnected ? (
              <div className="flex gap-2">
                <button onClick={handleSync} disabled={syncing || tradingMode !== 'paper'}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors">
                  {syncing ? 'Syncing...' : 'Sync'}
                </button>
                <button onClick={() => { disconnectAlpacaPaper(); setPaperKeyId(''); if (user) saveAlpacaCredsToFirestore(user.uid, 'paper', null); }}
                  className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded-lg text-sm font-medium transition-colors">
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input type="text" value={paperKeyId} onChange={(e) => setPaperKeyId(e.target.value.trim())} placeholder="Paper Key ID (PK...)"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                <input type="password" value={paperSecret} onChange={(e) => setPaperSecret(e.target.value.trim())} placeholder="Paper Secret Key"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                <button onClick={handleConnectPaper} disabled={connecting || !paperKeyId || !paperSecret}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors">
                  {connecting ? 'Connecting...' : 'Connect Paper Account'}
                </button>
              </div>
            )}
          </div>

          {/* Live */}
          <div className={`p-4 rounded-lg border ${alpacaLiveConnected ? 'bg-red-900/20 border-red-800' : 'bg-slate-700/50 border-slate-600'}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Live Trading</h3>
                {tradingMode === 'live' && <span className="px-1.5 py-0.5 bg-red-500/20 border border-red-500/50 rounded text-xs text-red-400">Active</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${alpacaLiveConnected ? 'bg-emerald-500' : 'bg-slate-500'}`} />
                <span className={`text-xs ${alpacaLiveConnected ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {alpacaLiveConnected ? 'Connected' : 'Not connected'}
                </span>
              </div>
            </div>
            {alpacaLiveConnected ? (
              <div className="flex gap-2">
                <button onClick={handleSync} disabled={syncing || tradingMode !== 'live'}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors">
                  {syncing ? 'Syncing...' : 'Sync'}
                </button>
                <button onClick={() => { disconnectAlpacaLive(); setLiveKeyId(''); if (user) saveAlpacaCredsToFirestore(user.uid, 'live', null); }}
                  className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 rounded-lg text-sm font-medium transition-colors">
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input type="text" value={liveKeyId} onChange={(e) => setLiveKeyId(e.target.value.trim())} placeholder="Live Key ID (AK...)"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
                <input type="password" value={liveSecret} onChange={(e) => setLiveSecret(e.target.value.trim())} placeholder="Live Secret Key"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-500" />
                <button onClick={handleConnectLive} disabled={connecting || !liveKeyId || !liveSecret}
                  className="w-full py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors">
                  {connecting ? 'Connecting...' : 'Connect Live Account'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Auto-Trading & Risk */}
      <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Auto-Trading</h2>
            <p className="text-slate-400 text-sm mt-1">ORB strategy executes automatically when signals fire</p>
          </div>
          <button
            onClick={() => updateAutoTradeConfig({ enabled: !autoTradeConfig.enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoTradeConfig.enabled ? 'bg-emerald-600' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              autoTradeConfig.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {autoTradeConfig.enabled && tradingMode === 'live' && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
            Auto-trading is ON in LIVE mode. Real trades will execute automatically.
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
            <div>
              <p className="text-sm font-medium">Max $ Per Trade</p>
              <p className="text-xs text-slate-400">15% of $100k = $15,000</p>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-slate-400 text-sm">$</span>
              <input type="number" value={autoTradeConfig.maxTradeDollarAmount ?? 15000}
                onChange={(e) => updateAutoTradeConfig({ maxTradeDollarAmount: parseInt(e.target.value) || 15000 })}
                min="100" step="250"
                className="w-24 px-3 py-1 bg-slate-700 border border-slate-600 rounded-lg text-center text-sm focus:outline-none focus:border-emerald-500" />
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
            <div>
              <p className="text-sm font-medium">Max Trades Per Day</p>
            </div>
            <input type="number" value={autoTradeConfig.maxTradesPerDay}
              onChange={(e) => updateAutoTradeConfig({ maxTradesPerDay: parseInt(e.target.value) || 1 })}
              min="1" max="100"
              className="w-20 px-3 py-1 bg-slate-700 border border-slate-600 rounded-lg text-center text-sm focus:outline-none focus:border-emerald-500" />
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
            <div>
              <p className="text-sm font-medium">Yearly Drawdown Limit</p>
              <p className="text-xs text-slate-400">Stop trading if down this % from Jan 1</p>
            </div>
            <div className="flex items-center gap-1">
              <input type="number" value={autoTradeConfig.yearlyDrawdownLimit ?? 20}
                onChange={(e) => updateAutoTradeConfig({ yearlyDrawdownLimit: parseInt(e.target.value) || 20 })}
                min="5" max="50"
                className="w-20 px-3 py-1 bg-slate-700 border border-slate-600 rounded-lg text-center text-sm focus:outline-none focus:border-emerald-500" />
              <span className="text-slate-400 text-sm">%</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
            <div>
              <p className="text-sm font-medium">Bear Market Override</p>
              <p className="text-xs text-slate-400">Trade even when SPY is below 200 SMA</p>
            </div>
            <button
              onClick={() => updateMarketRegime({ overrideEnabled: !marketRegime.overrideEnabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                marketRegime.overrideEnabled ? 'bg-amber-600' : 'bg-slate-600'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                marketRegime.overrideEnabled ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
            <div>
              <p className="text-sm font-medium">Trading Hours Only</p>
              <p className="text-xs text-slate-400">9:30 AM - 4:00 PM ET</p>
            </div>
            <button
              onClick={() => updateAutoTradeConfig({ tradingHoursOnly: !autoTradeConfig.tradingHoursOnly })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoTradeConfig.tradingHoursOnly ? 'bg-emerald-600' : 'bg-slate-600'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoTradeConfig.tradingHoursOnly ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
          </div>
        </div>
      </div>

      {/* Account */}
      {isConfigured && user && (
        <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-4">
          <h2 className="text-lg font-semibold mb-4">Account</h2>
          <div className="flex items-center gap-4 mb-4 p-3 bg-slate-700/50 rounded-lg">
            <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-lg font-bold">
              {(userProfile?.displayName || user.email || '?')[0].toUpperCase()}
            </div>
            <div>
              <p className="font-medium">{userProfile?.displayName || 'User'}</p>
              <p className="text-sm text-slate-400">{user.email}</p>
            </div>
          </div>
          <button onClick={logOut}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium transition-colors">
            Sign Out
          </button>
        </div>
      )}

      {/* About */}
      <div className="bg-slate-800 rounded-xl p-4 md:p-6">
        <h2 className="text-lg font-semibold mb-3">About</h2>
        <div className="text-slate-400 text-sm space-y-1">
          <p>AutoTrader — ORB Day Trading</p>
          <p>
            <a href="https://alpaca.markets" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
              Powered by Alpaca Markets
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
