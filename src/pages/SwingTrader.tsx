import { useState, useMemo } from 'react';
import { useSwingStore } from '../store/useSwingStore';
import type { MarketRegime, SwingStrategyConfig, SwingEntryRule, SwingExitRule } from '../types';
import {
  DEFAULT_SWING_SYMBOLS,
  calculateRequiredMonthlyReturn,
  calculateWinRate,
} from '../services/swingTrader';

// ============================================================================
// Helper Components
// ============================================================================

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function RegimeBadge({ regime }: { regime: MarketRegime }) {
  const colors = {
    uptrend: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    downtrend: 'bg-red-500/20 text-red-400 border-red-500/30',
    sideways: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  };
  const labels = {
    uptrend: 'Uptrend',
    downtrend: 'Downtrend',
    sideways: 'Sideways',
  };
  const arrows = {
    uptrend: '\u2191',
    downtrend: '\u2193',
    sideways: '\u2194',
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colors[regime]}`}>
      <span>{arrows[regime]}</span>
      {labels[regime]}
    </span>
  );
}

function StatCard({ label, value, subValue, color }: {
  label: string;
  value: string;
  subValue?: string;
  color?: 'green' | 'red' | 'blue' | 'amber' | 'default';
}) {
  const textColor = {
    green: 'text-emerald-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    amber: 'text-amber-400',
    default: 'text-white',
  }[color || 'default'];

  return (
    <div className="bg-slate-800 rounded-xl p-4">
      <p className="text-slate-400 text-sm mb-1">{label}</p>
      <p className={`text-lg md:text-xl font-bold ${textColor}`}>{value}</p>
      {subValue && <p className="text-slate-500 text-xs mt-1">{subValue}</p>}
    </div>
  );
}

// ============================================================================
// Strategy Editor Panel
// ============================================================================

function StrategyEditor({ label, regime, strategy, onChange }: {
  label: string;
  regime: MarketRegime;
  strategy: SwingStrategyConfig;
  onChange: (updates: Partial<SwingStrategyConfig>) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const regimeColors = {
    uptrend: 'border-emerald-500/30',
    downtrend: 'border-red-500/30',
    sideways: 'border-amber-500/30',
  };

  const updateEntry = (updates: Partial<SwingEntryRule>) => {
    onChange({ entryRules: { ...strategy.entryRules, ...updates } });
  };

  const updateExit = (updates: Partial<SwingExitRule>) => {
    onChange({ exitRules: { ...strategy.exitRules, ...updates } });
  };

  return (
    <div className={`bg-slate-800 rounded-xl p-4 border ${regimeColors[regime]}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <RegimeBadge regime={regime} />
          <span className="text-white font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={strategy.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="w-4 h-4 rounded bg-slate-700 border-slate-600"
            />
            <span className="text-sm text-slate-400">Enabled</span>
          </label>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-slate-400 hover:text-white text-sm"
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>

      {!isExpanded && (
        <div className="text-sm text-slate-400 space-y-1">
          <p>Direction: {strategy.direction} | TP: {strategy.exitRules.takeProfitPercent}% | SL: {strategy.exitRules.stopLossPercent}% | Size: {strategy.positionSizePercent}%</p>
        </div>
      )}

      {isExpanded && (
        <div className="space-y-4 mt-4">
          {/* Direction */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">Trade Direction</label>
            <select
              value={strategy.direction}
              onChange={(e) => onChange({ direction: e.target.value as 'long' | 'short' | 'both' })}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
            >
              <option value="long">Long Only (buy low, sell high)</option>
              <option value="short">Short Only (sell high, buy low)</option>
              <option value="both">Both Directions</option>
            </select>
          </div>

          {/* Position Size */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">Position Size (% of portfolio)</label>
            <input
              type="number"
              value={strategy.positionSizePercent}
              onChange={(e) => onChange({ positionSizePercent: Number(e.target.value) })}
              min={5} max={50} step={1}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {/* Entry Rules */}
          <div>
            <h4 className="text-sm font-medium text-slate-300 mb-2">Entry Rules</h4>
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={strategy.entryRules.useRSI} onChange={(e) => updateEntry({ useRSI: e.target.checked })} className="w-4 h-4 rounded" />
                  <span className="text-sm text-slate-400">RSI Filter</span>
                </div>
                {strategy.entryRules.useRSI && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">OS:</span>
                    <input type="number" value={strategy.entryRules.rsiOversold} onChange={(e) => updateEntry({ rsiOversold: Number(e.target.value) })} className="w-14 bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-center" min={10} max={50} />
                    <span className="text-slate-500">OB:</span>
                    <input type="number" value={strategy.entryRules.rsiOverbought} onChange={(e) => updateEntry({ rsiOverbought: Number(e.target.value) })} className="w-14 bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-center" min={50} max={90} />
                  </div>
                )}
              </label>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={strategy.entryRules.useSMACross} onChange={(e) => updateEntry({ useSMACross: e.target.checked })} className="w-4 h-4 rounded" />
                <span className="text-sm text-slate-400">SMA Crossover (pullback to moving average)</span>
              </label>

              <label className="flex items-center gap-2">
                <input type="checkbox" checked={strategy.entryRules.useMACD} onChange={(e) => updateEntry({ useMACD: e.target.checked })} className="w-4 h-4 rounded" />
                <span className="text-sm text-slate-400">MACD Crossover</span>
              </label>

              <label className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={strategy.entryRules.useBollinger} onChange={(e) => updateEntry({ useBollinger: e.target.checked })} className="w-4 h-4 rounded" />
                  <span className="text-sm text-slate-400">Bollinger Bands</span>
                </div>
                {strategy.entryRules.useBollinger && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">Period:</span>
                    <input type="number" value={strategy.entryRules.bollingerPeriod} onChange={(e) => updateEntry({ bollingerPeriod: Number(e.target.value) })} className="w-14 bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-center" min={10} max={50} />
                    <span className="text-slate-500">StdDev:</span>
                    <input type="number" value={strategy.entryRules.bollingerStdDev} onChange={(e) => updateEntry({ bollingerStdDev: Number(e.target.value) })} className="w-14 bg-slate-700 border border-slate-600 rounded px-1 py-0.5 text-center" min={1} max={4} step={0.5} />
                  </div>
                )}
              </label>

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Min Confidence</span>
                <input type="number" value={strategy.entryRules.minConfidence} onChange={(e) => updateEntry({ minConfidence: Number(e.target.value) })} className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-center" min={20} max={100} />
              </div>
            </div>
          </div>

          {/* Exit Rules */}
          <div>
            <h4 className="text-sm font-medium text-slate-300 mb-2">Exit Rules</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Take Profit %</label>
                <input type="number" value={strategy.exitRules.takeProfitPercent} onChange={(e) => updateExit({ takeProfitPercent: Number(e.target.value) })} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm" min={1} max={50} step={0.5} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Stop Loss %</label>
                <input type="number" value={strategy.exitRules.stopLossPercent} onChange={(e) => updateExit({ stopLossPercent: Number(e.target.value) })} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm" min={0.5} max={20} step={0.5} />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Trailing Stop %</label>
                <input type="number" value={strategy.exitRules.trailingStopPercent ?? 0} onChange={(e) => { const v = Number(e.target.value); updateExit({ trailingStopPercent: v > 0 ? v : null }); }} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm" min={0} max={20} step={0.5} />
                <p className="text-xs text-slate-600 mt-0.5">0 = disabled</p>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Time Stop (days)</label>
                <input type="number" value={strategy.exitRules.timeStopDays ?? 0} onChange={(e) => { const v = Number(e.target.value); updateExit({ timeStopDays: v > 0 ? v : null }); }} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm" min={0} max={90} />
                <p className="text-xs text-slate-600 mt-0.5">0 = no time limit</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main SwingTrader Page
// ============================================================================

type TabId = 'overview' | 'strategies' | 'positions' | 'history' | 'watchlist';

export function SwingTrader() {
  const store = useSwingStore();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [newSymbol, setNewSymbol] = useState('');

  // Computed values
  const equity = store.getCurrentEquity();
  const winRate = store.getWinRate();
  const totalTrades = store.winCount + store.lossCount;
  const monthsElapsed = store.startedAt
    ? Math.max(1, Math.floor((Date.now() - new Date(store.startedAt).getTime()) / (30 * 24 * 60 * 60 * 1000)))
    : 0;
  const monthsRemaining = Math.max(0, store.config.goalMonths - monthsElapsed);
  const requiredMonthlyReturn = calculateRequiredMonthlyReturn(equity, store.config.goalCapital, monthsRemaining);
  const progressPercent = Math.min(100, ((equity - store.config.initialCapital) / (store.config.goalCapital - store.config.initialCapital)) * 100);
  const maxDrawdown = store.peakEquity > 0 ? ((store.peakEquity - Math.min(equity, store.peakEquity)) / store.peakEquity) * 100 : 0;

  // Average P/L per trade
  const avgWin = useMemo(() => {
    const wins = store.completedTrades.filter((t) => t.profitLoss !== null && t.profitLoss > 0);
    if (wins.length === 0) return 0;
    return wins.reduce((sum, t) => sum + (t.profitLossPercent || 0), 0) / wins.length;
  }, [store.completedTrades]);

  const avgLoss = useMemo(() => {
    const losses = store.completedTrades.filter((t) => t.profitLoss !== null && t.profitLoss <= 0);
    if (losses.length === 0) return 0;
    return losses.reduce((sum, t) => sum + (t.profitLossPercent || 0), 0) / losses.length;
  }, [store.completedTrades]);

  // Regime distribution
  const regimeCounts = useMemo(() => {
    const counts = { uptrend: 0, downtrend: 0, sideways: 0 };
    for (const trade of store.completedTrades) {
      counts[trade.regime]++;
    }
    return counts;
  }, [store.completedTrades]);

  const handleAddSymbol = () => {
    const sym = newSymbol.trim().toUpperCase();
    if (sym && !store.config.symbols.includes(sym)) {
      store.addSymbol(sym);
      setNewSymbol('');
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset the Swing Trader portfolio? This will clear all positions, trades, and equity history. This cannot be undone.')) {
      store.resetSwingPortfolio();
    }
  };

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'strategies', label: 'Strategies' },
    { id: 'positions', label: 'Positions' },
    { id: 'history', label: 'Trade History' },
    { id: 'watchlist', label: 'Watchlist' },
  ];

  return (
    <div className="text-white">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 md:mb-8 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Swing Trader</h1>
          <p className="text-slate-400 text-sm md:text-base mt-1">
            Adaptive regime-based swing trading &mdash; {formatCurrency(store.config.initialCapital)} to {formatCurrency(store.config.goalCapital)} in {store.config.goalMonths} months
          </p>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300"
          >
            Reset
          </button>
          <button
            onClick={() => store.isRunning ? store.stopSwingTrader() : store.startSwingTrader()}
            className={`px-6 py-2 rounded-lg text-sm font-medium ${
              store.isRunning
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }`}
          >
            {store.isRunning ? 'Stop Trading' : 'Start Trading'}
          </button>
        </div>
      </div>

      {/* Goal Progress Bar */}
      <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-slate-400">Goal Progress</span>
          <span className="text-sm font-medium">
            {formatCurrency(equity)} / {formatCurrency(store.config.goalCapital)}
            {equity >= store.config.goalCapital && (
              <span className="ml-2 text-emerald-400 font-bold">GOAL REACHED!</span>
            )}
          </span>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${
              progressPercent >= 100 ? 'bg-emerald-400' : progressPercent >= 50 ? 'bg-blue-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-slate-500">
          <span>{formatCurrency(store.config.initialCapital)} start</span>
          {monthsRemaining > 0 && (
            <span>Need {requiredMonthlyReturn.toFixed(1)}%/month for {monthsRemaining} months</span>
          )}
          <span>{formatCurrency(store.config.goalCapital)} goal</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 md:mb-8 bg-slate-800 rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 min-w-[80px] px-2 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-3 md:space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <StatCard
              label="Current Equity"
              value={formatCurrency(equity)}
              subValue={`Started at ${formatCurrency(store.config.initialCapital)}`}
              color={equity >= store.config.initialCapital ? 'green' : 'red'}
            />
            <StatCard
              label="Total Return"
              value={formatPercent(store.totalReturnPercent)}
              subValue={formatCurrency(store.totalReturn)}
              color={store.totalReturn >= 0 ? 'green' : 'red'}
            />
            <StatCard
              label="Win Rate"
              value={totalTrades > 0 ? `${winRate.toFixed(1)}%` : 'N/A'}
              subValue={`${store.winCount}W / ${store.lossCount}L (${totalTrades} total)`}
              color={winRate >= 50 ? 'green' : winRate > 0 ? 'amber' : 'default'}
            />
            <StatCard
              label="Max Drawdown"
              value={`${maxDrawdown.toFixed(1)}%`}
              subValue={`Peak: ${formatCurrency(store.peakEquity)}`}
              color={maxDrawdown > 10 ? 'red' : maxDrawdown > 5 ? 'amber' : 'green'}
            />
          </div>

          {/* Secondary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <StatCard
              label="Cash Available"
              value={formatCurrency(store.cashBalance)}
              subValue={`${store.positions.length} open position${store.positions.length !== 1 ? 's' : ''}`}
            />
            <StatCard
              label="Avg Win"
              value={avgWin > 0 ? formatPercent(avgWin) : 'N/A'}
              color="green"
            />
            <StatCard
              label="Avg Loss"
              value={avgLoss < 0 ? formatPercent(avgLoss) : 'N/A'}
              color="red"
            />
            <StatCard
              label="Status"
              value={store.isRunning ? 'Active' : 'Stopped'}
              subValue={store.startedAt ? `Since ${formatDate(store.startedAt)}` : 'Not started'}
              color={store.isRunning ? 'green' : 'default'}
            />
          </div>

          {/* Market Regimes */}
          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            <h2 className="text-lg md:text-xl font-semibold mb-4">Market Regime Detection</h2>
            {Object.keys(store.currentRegimes).length === 0 ? (
              <p className="text-slate-400 text-sm">
                No regime data yet. Start the swing trader to begin analyzing market conditions for your watchlist.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {Object.entries(store.currentRegimes).map(([symbol, regime]) => (
                  <div key={symbol} className="bg-slate-700 rounded-lg p-3 flex items-center justify-between">
                    <span className="font-medium text-sm">{symbol}</span>
                    <RegimeBadge regime={regime} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* How It Works */}
          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-3">How Swing Trader Works</h2>
            <div className="grid md:grid-cols-3 gap-4 text-sm text-slate-400">
              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <RegimeBadge regime="uptrend" />
                  <span className="text-white font-medium">Uptrend</span>
                </div>
                <p>Buys pullbacks to SMA support. Rides momentum with wider take-profit targets (8%). Uses trailing stop to lock in gains.</p>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <RegimeBadge regime="downtrend" />
                  <span className="text-white font-medium">Downtrend</span>
                </div>
                <p>Shorts rallies to SMA resistance. Smaller position sizes and tighter stop losses. Can buy extreme oversold bounces.</p>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <RegimeBadge regime="sideways" />
                  <span className="text-white font-medium">Sideways</span>
                </div>
                <p>Mean reversion at Bollinger Band extremes. Buys at lower band, shorts at upper band. Quick in-and-out trades.</p>
              </div>
            </div>
          </div>

          {/* Trade Distribution by Regime */}
          {totalTrades > 0 && (
            <div className="bg-slate-800 rounded-xl p-6">
              <h2 className="text-lg font-semibold mb-4">Trades by Market Regime</h2>
              <div className="flex gap-4">
                {(['uptrend', 'downtrend', 'sideways'] as MarketRegime[]).map((regime) => {
                  const count = regimeCounts[regime];
                  const pct = totalTrades > 0 ? (count / totalTrades) * 100 : 0;
                  const trades = store.completedTrades.filter((t) => t.regime === regime);
                  const wins = trades.filter((t) => t.profitLoss !== null && t.profitLoss > 0).length;
                  const wr = trades.length > 0 ? (wins / trades.length) * 100 : 0;

                  return (
                    <div key={regime} className="flex-1 bg-slate-700 rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <RegimeBadge regime={regime} />
                      </div>
                      <p className="text-2xl font-bold text-white">{count}</p>
                      <p className="text-xs text-slate-400">{pct.toFixed(0)}% of trades</p>
                      <p className="text-xs text-slate-400 mt-1">Win rate: {wr.toFixed(0)}%</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'strategies' && (
        <div className="space-y-6">
          {/* General Config */}
          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">General Configuration</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Starting Capital</label>
                <input
                  type="number"
                  value={store.config.initialCapital}
                  onChange={(e) => store.updateConfig({ initialCapital: Number(e.target.value) })}
                  min={1000} step={500}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Goal Capital</label>
                <input
                  type="number"
                  value={store.config.goalCapital}
                  onChange={(e) => store.updateConfig({ goalCapital: Number(e.target.value) })}
                  min={store.config.initialCapital + 1000} step={1000}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Goal Months</label>
                <input
                  type="number"
                  value={store.config.goalMonths}
                  onChange={(e) => store.updateConfig({ goalMonths: Number(e.target.value) })}
                  min={6} max={120}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Max Concurrent Positions</label>
                <input
                  type="number"
                  value={store.config.maxPositions}
                  onChange={(e) => store.updateConfig({ maxPositions: Number(e.target.value) })}
                  min={1} max={10}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Regime Detection Config */}
          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Regime Detection Settings</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Fast SMA Period</label>
                <input
                  type="number"
                  value={store.config.regimeDetection.smaFastPeriod}
                  onChange={(e) => store.updateConfig({ regimeDetection: { ...store.config.regimeDetection, smaFastPeriod: Number(e.target.value) } })}
                  min={5} max={50}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Slow SMA Period</label>
                <input
                  type="number"
                  value={store.config.regimeDetection.smaSlowPeriod}
                  onChange={(e) => store.updateConfig({ regimeDetection: { ...store.config.regimeDetection, smaSlowPeriod: Number(e.target.value) } })}
                  min={20} max={200}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">ADX Trend Threshold</label>
                <input
                  type="number"
                  value={store.config.regimeDetection.adxTrendThreshold}
                  onChange={(e) => store.updateConfig({ regimeDetection: { ...store.config.regimeDetection, adxTrendThreshold: Number(e.target.value) } })}
                  min={15} max={40}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">Below this = sideways, above = trending</p>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">RSI Period</label>
                <input
                  type="number"
                  value={store.config.regimeDetection.rsiPeriod}
                  onChange={(e) => store.updateConfig({ regimeDetection: { ...store.config.regimeDetection, rsiPeriod: Number(e.target.value) } })}
                  min={7} max={28}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">ADX Period</label>
                <input
                  type="number"
                  value={store.config.regimeDetection.adxPeriod}
                  onChange={(e) => store.updateConfig({ regimeDetection: { ...store.config.regimeDetection, adxPeriod: Number(e.target.value) } })}
                  min={7} max={28}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Lookback Days</label>
                <input
                  type="number"
                  value={store.config.regimeDetection.lookbackDays}
                  onChange={(e) => store.updateConfig({ regimeDetection: { ...store.config.regimeDetection, lookbackDays: Number(e.target.value) } })}
                  min={20} max={200}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Per-Regime Strategies */}
          <StrategyEditor
            label="Uptrend Strategy"
            regime="uptrend"
            strategy={store.config.uptrendStrategy}
            onChange={(updates) => store.updateConfig({ uptrendStrategy: { ...store.config.uptrendStrategy, ...updates } })}
          />

          <StrategyEditor
            label="Downtrend Strategy"
            regime="downtrend"
            strategy={store.config.downtrendStrategy}
            onChange={(updates) => store.updateConfig({ downtrendStrategy: { ...store.config.downtrendStrategy, ...updates } })}
          />

          <StrategyEditor
            label="Sideways Strategy"
            regime="sideways"
            strategy={store.config.sidewaysStrategy}
            onChange={(updates) => store.updateConfig({ sidewaysStrategy: { ...store.config.sidewaysStrategy, ...updates } })}
          />
        </div>
      )}

      {activeTab === 'positions' && (
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Open Positions ({store.positions.length})</h2>
            {store.positions.length === 0 ? (
              <p className="text-slate-400 text-sm">
                No open positions. {store.isRunning ? 'The swing trader is scanning for opportunities...' : 'Start the swing trader to begin trading.'}
              </p>
            ) : (
              <div className="space-y-3">
                {store.positions.map((pos) => (
                  <div key={pos.id} className="bg-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold">{pos.symbol}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                          pos.direction === 'long' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {pos.direction.toUpperCase()}
                        </span>
                        <RegimeBadge regime={pos.regime} />
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${pos.unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatCurrency(pos.unrealizedPnL)} ({formatPercent(pos.unrealizedPnLPercent)})
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm text-slate-400">
                      <div>
                        <p className="text-slate-500 text-xs">Entry</p>
                        <p>${pos.entryPrice.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Current</p>
                        <p>${pos.currentPrice.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Shares</p>
                        <p>{pos.shares}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs">Opened</p>
                        <p>{formatDate(pos.entryDate)}</p>
                      </div>
                    </div>
                    {pos.entrySignals.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {pos.entrySignals.map((signal, i) => (
                          <span key={i} className="text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded">
                            {signal}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Trade History ({store.completedTrades.length})</h2>
              {store.completedTrades.length > 0 && (
                <button
                  onClick={store.clearTradeHistory}
                  className="text-sm text-slate-400 hover:text-slate-300"
                >
                  Clear History
                </button>
              )}
            </div>
            {store.completedTrades.length === 0 ? (
              <p className="text-slate-400 text-sm">No completed trades yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-700">
                      <th className="text-left py-2 px-2">Symbol</th>
                      <th className="text-left py-2 px-2">Dir</th>
                      <th className="text-left py-2 px-2">Regime</th>
                      <th className="text-right py-2 px-2">Entry</th>
                      <th className="text-right py-2 px-2">Exit</th>
                      <th className="text-right py-2 px-2">P/L</th>
                      <th className="text-right py-2 px-2">P/L %</th>
                      <th className="text-left py-2 px-2">Exit Reason</th>
                      <th className="text-left py-2 px-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {store.completedTrades.slice(0, 50).map((trade) => (
                      <tr key={trade.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                        <td className="py-2 px-2 font-medium">{trade.symbol}</td>
                        <td className="py-2 px-2">
                          <span className={trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}>
                            {trade.direction === 'long' ? 'LONG' : 'SHORT'}
                          </span>
                        </td>
                        <td className="py-2 px-2"><RegimeBadge regime={trade.regime} /></td>
                        <td className="py-2 px-2 text-right">${trade.entryPrice.toFixed(2)}</td>
                        <td className="py-2 px-2 text-right">{trade.exitPrice ? `$${trade.exitPrice.toFixed(2)}` : '-'}</td>
                        <td className={`py-2 px-2 text-right font-medium ${(trade.profitLoss || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trade.profitLoss !== null ? formatCurrency(trade.profitLoss) : '-'}
                        </td>
                        <td className={`py-2 px-2 text-right ${(trade.profitLossPercent || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {trade.profitLossPercent !== null ? formatPercent(trade.profitLossPercent) : '-'}
                        </td>
                        <td className="py-2 px-2 text-slate-400 text-xs">
                          {trade.exitReason?.replace('_', ' ') || '-'}
                        </td>
                        <td className="py-2 px-2 text-slate-400 text-xs">{formatDate(trade.entryDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'watchlist' && (
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold mb-4">Swing Trader Watchlist</h2>
            <p className="text-sm text-slate-400 mb-4">
              These symbols are monitored independently from the day trading watchlist. The swing trader will analyze market regime and generate signals for each.
            </p>

            {/* Add Symbol */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
                placeholder="Add symbol (e.g. AAPL)"
                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleAddSymbol}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium"
              >
                Add
              </button>
              <button
                onClick={() => store.updateConfig({ symbols: [...DEFAULT_SWING_SYMBOLS] })}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-300"
              >
                Reset to Defaults
              </button>
            </div>

            {/* Symbol List */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {store.config.symbols.map((symbol) => (
                <div key={symbol} className="flex items-center justify-between bg-slate-700 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{symbol}</span>
                    {store.currentRegimes[symbol] && (
                      <RegimeBadge regime={store.currentRegimes[symbol]} />
                    )}
                  </div>
                  <button
                    onClick={() => store.removeSymbol(symbol)}
                    className="text-slate-400 hover:text-red-400 text-sm"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
