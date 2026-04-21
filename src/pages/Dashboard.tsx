import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { github } from '../services/github';
import type { OrbScannerStatus } from '../services/github';
import { checkMarketRegime } from '../services/marketRegime';
import { runDayTradingBacktest, type DayTradeResult } from '../services/backtester';
import { WatchlistCard } from '../components/portfolio/WatchlistCard';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export function Dashboard() {
  const {
    positions,
    cashBalance,
    portfolioSummary,
    trades,
    watchlist,
    tradingMode,
    paperPortfolio,
    alpacaConnected,
    alpacaSynced,
    alpacaPaperConnected,
    alpacaLiveConnected,
    autoTradeConfig,
    updateAutoTradeConfig,
    syncFromAlpaca,
    pdtStatus,
    marketRegime,
    updateMarketRegime,
  } = useStore();

  const isPaperMode = tradingMode === 'paper';
  const isLiveNotConnected = tradingMode === 'live' && (!alpacaConnected || !alpacaSynced);
  const displayPositions = isPaperMode ? (paperPortfolio?.positions || []) : (isLiveNotConnected ? [] : positions);
  const displayCash = isPaperMode ? (paperPortfolio?.cashBalance ?? 100000) : (isLiveNotConnected ? null : cashBalance);
  const displayBuyingPower = isPaperMode
    ? (paperPortfolio?.buyingPower ?? paperPortfolio?.cashBalance ?? 100000)
    : displayCash;
  const displayTrades = isPaperMode ? (paperPortfolio?.trades || []) : (isLiveNotConnected ? [] : trades);

  // Sync from Alpaca every 60s
  useEffect(() => {
    const interval = setInterval(() => {
      syncFromAlpaca().catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [syncFromAlpaca]);

  // Market regime check on load (once per session)
  const [regimeLoading, setRegimeLoading] = useState(false);
  useEffect(() => {
    if (!alpacaConnected || marketRegime.lastChecked) return;
    setRegimeLoading(true);
    checkMarketRegime(isPaperMode)
      .then(({ regime, spyPrice, sma200 }) => {
        updateMarketRegime({ regime, spyPrice, sma200, lastChecked: new Date() });
      })
      .catch(() => {})
      .finally(() => setRegimeLoading(false));
  }, [alpacaConnected]);

  // ORB scanner status via GitHub API
  const [orbStatus, setOrbStatus] = useState<OrbScannerStatus | null>(null);
  const [orbStatusBusy, setOrbStatusBusy] = useState(false);

  useEffect(() => {
    if (!github.isConfigured()) return;
    const fetchStatus = () => {
      github.getOrbScannerStatus().then(setOrbStatus).catch(() => {});
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleOrbToggle = async () => {
    if (!orbStatus || orbStatusBusy) return;
    setOrbStatusBusy(true);
    try {
      if (orbStatus.state === 'active') {
        await github.disableOrbScanner();
      } else {
        await github.enableOrbScanner();
      }
      const updated = await github.getOrbScannerStatus();
      setOrbStatus(updated);
    } catch { /* silent */ } finally {
      setOrbStatusBusy(false);
    }
  };

  const [orbSyncMsg, setOrbSyncMsg] = useState<string | null>(null);
  const handleOrbSyncWatchlist = async () => {
    setOrbSyncMsg(null);
    try {
      await github.updateWatchlist(watchlist);
      setOrbSyncMsg(`Synced ${watchlist.length} symbols`);
      setTimeout(() => setOrbSyncMsg(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setOrbSyncMsg(msg.includes('403') || msg.includes('404')
        ? 'PAT needs Contents permission'
        : `Sync failed: ${msg}`);
    }
  };

  // Backtest state
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [dayTradeResult, setDayTradeResult] = useState<DayTradeResult | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestYears, setBacktestYears] = useState<string>('1');
  const [realisticCosts, setRealisticCosts] = useState(true);

  const runQuickBacktest = async () => {
    setBacktestRunning(true);
    setBacktestError(null);
    setDayTradeResult(null);
    try {
      const isSpecificYear = backtestYears.length === 4 && !isNaN(parseInt(backtestYears));
      const yearsBack = isSpecificYear ? 20 : parseInt(backtestYears);
      const specificYear = isSpecificYear ? parseInt(backtestYears) : undefined;
      const result = await runDayTradingBacktest(
        watchlist, 100000, 25, 2, 1, yearsBack, specificYear,
        0, realisticCosts ? 0.02 : 0, 15, isPaperMode,
      );
      setDayTradeResult(result);
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setBacktestRunning(false);
    }
  };

  const totalPositionValue = displayPositions.reduce((sum, p) => sum + p.totalValue, 0);
  const totalPortfolioValue = isLiveNotConnected ? null : totalPositionValue + (displayCash ?? 0);
  const dayChange = isLiveNotConnected ? null
    : isPaperMode ? (paperPortfolio?.dayChange ?? null)
    : (portfolioSummary?.dayChange ?? null);

  const chartData = useMemo(() => {
    const history = isPaperMode
      ? paperPortfolio?.history
      : portfolioSummary?.portfolioHistory;
    if (!history || history.length === 0) return [];
    const dailyData = new Map<string, number>();
    history.forEach((snapshot) => {
      const date = new Date(snapshot.date);
      const dateKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dailyData.set(dateKey, snapshot.totalValue);
    });
    return Array.from(dailyData.entries()).map(([date, value]) => ({ date, value }));
  }, [isPaperMode, paperPortfolio?.history, portfolioSummary?.portfolioHistory]);

  const startingBalance = isPaperMode ? (paperPortfolio?.startingBalance ?? 100000) : null;
  const totalPnL = (() => {
    if (isLiveNotConnected || totalPortfolioValue === null) return null;
    if (isPaperMode && startingBalance !== null) return totalPortfolioValue - startingBalance;
    const liveHistory = portfolioSummary?.portfolioHistory;
    if (liveHistory && liveHistory.length > 0) return totalPortfolioValue - liveHistory[0].totalValue;
    return displayPositions.reduce((sum, p) => sum + p.totalGain, 0);
  })();
  const totalPnLPercent = (() => {
    if (totalPnL === null) return null;
    if (isPaperMode && startingBalance) return (totalPnL / startingBalance) * 100;
    const liveHistory = portfolioSummary?.portfolioHistory;
    if (liveHistory && liveHistory.length > 0 && liveHistory[0].totalValue > 0) {
      return (totalPnL / liveHistory[0].totalValue) * 100;
    }
    return null;
  })();

  // Determine if auto-trading should be paused
  const isBearish = marketRegime.regime === 'bearish' && !marketRegime.overrideEnabled;
  const isPDTPaused = pdtStatus.tradingPaused;
  const isAutoTradingActive = autoTradeConfig.enabled && !isBearish && !isPDTPaused;

  // Count today's trades
  const today = new Date().toLocaleDateString();
  const todaysTrades = displayTrades.filter(t => new Date(t.date).toLocaleDateString() === today);
  const todaysWins = todaysTrades.filter(t => t.type === 'sell' && t.price * t.shares > 0);

  return (
    <div className="text-white max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-bold">AutoTrader</h1>
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${
            isPaperMode ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
          }`}>
            {isPaperMode ? 'PAPER' : 'LIVE'}
          </span>
        </div>
        <NavLink to="/settings" className="p-2 rounded-lg hover:bg-slate-800 transition-colors text-slate-400 hover:text-white">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
        </NavLink>
      </div>

      {isLiveNotConnected && (
        <div className="mb-6 p-4 bg-slate-800/50 border border-slate-700 rounded-xl text-center">
          <p className="text-slate-400">Connect your Alpaca account in <NavLink to="/settings" className="text-emerald-400 hover:underline">Settings</NavLink> to get started.</p>
        </div>
      )}

      {/* Top Stats */}
      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6">
        <div className="bg-slate-800/80 rounded-xl p-4 md:p-5 border border-slate-700/50">
          <p className="text-slate-400 text-xs md:text-sm mb-1">Portfolio</p>
          <p className="text-xl md:text-2xl font-bold truncate">
            {totalPortfolioValue !== null ? `$${totalPortfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '--'}
          </p>
        </div>
        <div className="bg-slate-800/80 rounded-xl p-4 md:p-5 border border-slate-700/50">
          <p className="text-slate-400 text-xs md:text-sm mb-1">Day P&L</p>
          <p className={`text-xl md:text-2xl font-bold truncate ${
            dayChange !== null ? (dayChange >= 0 ? 'text-emerald-400' : 'text-red-400') : ''
          }`}>
            {dayChange !== null ? `${dayChange >= 0 ? '+' : ''}$${dayChange.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          </p>
        </div>
        <div className="bg-slate-800/80 rounded-xl p-4 md:p-5 border border-slate-700/50">
          <p className="text-slate-400 text-xs md:text-sm mb-1">Buying Power</p>
          <p className="text-xl md:text-2xl font-bold truncate">
            {displayBuyingPower !== null ? `$${displayBuyingPower.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '--'}
          </p>
        </div>
      </div>

      {/* Status Panel */}
      <div className="bg-slate-800/80 rounded-xl p-4 md:p-5 mb-6 border border-slate-700/50">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
          {/* Auto-Trading Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${isAutoTradingActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'}`} />
              <div>
                <p className="text-sm font-medium">Auto-Trading</p>
                <p className="text-xs text-slate-400">
                  {!autoTradeConfig.enabled ? 'Disabled' :
                   isBearish ? 'Paused (bear market)' :
                   isPDTPaused ? 'Paused (PDT limit)' :
                   'Active'}
                </p>
              </div>
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

          {/* Market Regime */}
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              regimeLoading ? 'bg-slate-500 animate-pulse' :
              marketRegime.regime === 'bullish' ? 'bg-emerald-500' : 'bg-red-500'
            }`} />
            <div>
              <p className="text-sm font-medium">Market</p>
              <p className="text-xs text-slate-400">
                {regimeLoading ? 'Checking...' :
                 !marketRegime.lastChecked ? 'Not checked' :
                 marketRegime.regime === 'bullish'
                   ? `Bullish (SPY $${marketRegime.spyPrice.toFixed(0)} > ${marketRegime.sma200.toFixed(0)} SMA)`
                   : `Bearish (SPY $${marketRegime.spyPrice.toFixed(0)} < ${marketRegime.sma200.toFixed(0)} SMA)`
                }
              </p>
            </div>
          </div>

          {/* PDT Status */}
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              pdtStatus.isAbovePDT ? 'bg-emerald-500' :
              pdtStatus.tradingPaused ? 'bg-red-500' : 'bg-amber-500'
            }`} />
            <div>
              <p className="text-sm font-medium">PDT Status</p>
              <p className="text-xs text-slate-400">
                {pdtStatus.isAbovePDT
                  ? `Above $25k — unlimited trades`
                  : pdtStatus.tradingPaused
                  ? `No day trades remaining (${pdtStatus.dayTradeCount}/3 used)`
                  : `${pdtStatus.dayTradesRemaining} day trade${pdtStatus.dayTradesRemaining !== 1 ? 's' : ''} remaining`
                }
              </p>
            </div>
          </div>

          {/* Today's Activity */}
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${todaysTrades.length > 0 ? 'bg-blue-500' : 'bg-slate-500'}`} />
            <div>
              <p className="text-sm font-medium">Today</p>
              <p className="text-xs text-slate-400">
                {todaysTrades.length === 0 ? 'No trades yet' :
                  `${todaysTrades.length} trade${todaysTrades.length !== 1 ? 's' : ''} placed`
                }
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          {/* Performance Chart */}
          <div className="bg-slate-800/80 rounded-xl p-4 md:p-6 border border-slate-700/50">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Performance</h2>
              <div className="text-right">
                {totalPnL !== null && !isLiveNotConnected ? (
                  <>
                    <span className={`text-lg font-semibold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className={`text-sm ml-2 ${(totalPnLPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      ({(totalPnLPercent ?? 0) >= 0 ? '+' : ''}{(totalPnLPercent ?? 0).toFixed(2)}%)
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500">--</span>
                )}
              </div>
            </div>
            <div className="h-48 md:h-56">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                    <YAxis
                      stroke="#64748b"
                      fontSize={11}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                      domain={['dataMin - 500', 'dataMax + 500']}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                      formatter={(value: number) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Value']}
                    />
                    {startingBalance !== null && <ReferenceLine y={startingBalance} stroke="#475569" strokeDasharray="5 5" />}
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={(totalPnL ?? 0) >= 0 ? '#10b981' : '#ef4444'}
                      strokeWidth={2}
                      dot={chartData.length < 20}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500">
                  <p className="text-sm">Portfolio chart appears after trades</p>
                </div>
              )}
            </div>
          </div>

          {/* Open Positions */}
          <div className="bg-slate-800/80 rounded-xl p-4 md:p-6 border border-slate-700/50">
            <h2 className="text-lg font-semibold mb-4">Open Positions</h2>
            {displayPositions.filter(p => p.shares > 0).length === 0 ? (
              <p className="text-sm text-slate-500">No open positions</p>
            ) : (
              <div className="space-y-2">
                {displayPositions.filter(p => p.shares > 0).map((position) => (
                  <div key={position.id} className="flex justify-between items-center p-3 bg-slate-700/40 rounded-lg">
                    <div>
                      <span className="font-semibold">{position.symbol}</span>
                      <span className="text-xs text-slate-400 ml-2">{position.shares} shares</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">
                        ${position.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className={`text-xs ml-2 ${position.totalGain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {position.totalGain >= 0 ? '+' : ''}{position.totalGainPercent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ORB Backtest */}
          <div className="bg-slate-800/80 rounded-xl p-4 md:p-6 border border-slate-700/50">
            <h2 className="text-lg font-semibold mb-3">ORB Backtest</h2>
            <div className="flex gap-2 flex-wrap mb-2">
              <select
                value={backtestYears}
                onChange={(e) => setBacktestYears(e.target.value)}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm"
              >
                <option value="1">Last 1 Year</option>
                <option value="2">Last 2 Years</option>
                <option value="5">Last 5 Years</option>
                <option value="10">Last 10 Years</option>
                <option value="20">Last 20 Years</option>
                <optgroup label="Specific Year">
                  {Array.from({ length: new Date().getFullYear() - 1996 }, (_, i) => new Date().getFullYear() - 1 - i).map(year => (
                    <option key={year} value={year.toString()}>{year}</option>
                  ))}
                </optgroup>
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={realisticCosts} onChange={(e) => setRealisticCosts(e.target.checked)} className="rounded" />
                Costs
              </label>
              <button
                onClick={runQuickBacktest}
                disabled={backtestRunning || !(isPaperMode ? alpacaPaperConnected : alpacaLiveConnected)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                {backtestRunning ? 'Running...' : 'Run'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              {watchlist.length} stocks, 25% position, 2% TP, 1% SL, $100k start.
            </p>

            {backtestError && (
              <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300 mb-3">
                {backtestError}
              </div>
            )}

            {dayTradeResult && (
              <div className="space-y-2 pt-2 border-t border-slate-700">
                <div className="flex justify-between text-sm font-semibold">
                  <span>${dayTradeResult.initialCapital.toLocaleString()}</span>
                  <span className={dayTradeResult.totalReturnPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    ${dayTradeResult.finalCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    {' '}({dayTradeResult.totalReturnPercent >= 0 ? '+' : ''}{dayTradeResult.totalReturnPercent.toFixed(1)}%)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Win Rate</span>
                    <span className={dayTradeResult.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>
                      {dayTradeResult.winRate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Trades</span>
                    <span>{dayTradeResult.totalTrades}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Avg Win</span>
                    <span className="text-emerald-400">+{dayTradeResult.avgWinPercent.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Avg Loss</span>
                    <span className="text-red-400">{dayTradeResult.avgLossPercent.toFixed(2)}%</span>
                  </div>
                </div>
                {dayTradeResult.totalCosts > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Costs</span>
                    <span className="text-orange-400">-${dayTradeResult.totalCosts.toFixed(0)}</span>
                  </div>
                )}

                <div className="mt-2 p-3 bg-slate-900/50 border border-slate-600 rounded-lg">
                  <div className="flex justify-between text-sm font-semibold mb-1">
                    <span className="text-amber-400">Realistic Estimate</span>
                    <span className={dayTradeResult.realisticReturnPercent >= 0 ? 'text-amber-400' : 'text-red-400'}>
                      {dayTradeResult.realisticReturnPercent >= 0 ? '+' : ''}{dayTradeResult.realisticReturnPercent.toFixed(1)}%
                      {' '}(${dayTradeResult.realisticFinalCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    -{dayTradeResult.haircutPercent.toFixed(0)}% haircut for real-world factors
                  </p>
                </div>

                {dayTradeResult.goalReached && (
                  <div className="p-3 bg-emerald-900/30 border border-emerald-600 rounded-lg text-sm text-emerald-300">
                    Goal reached ($500k) on {dayTradeResult.goalReachedDate}
                  </div>
                )}
                {dayTradeResult.drawdownStopTriggered && !dayTradeResult.goalReached && (
                  <div className="p-2 bg-yellow-900/20 border border-yellow-700 rounded-lg text-xs text-yellow-400">
                    Drawdown protection triggered on {dayTradeResult.drawdownStopDate}
                  </div>
                )}

                {dayTradeResult.trades.length > 0 && (
                  <details className="pt-1">
                    <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400">
                      View {dayTradeResult.trades.length} trades
                    </summary>
                    <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                      {dayTradeResult.trades.slice(-50).map((t, i) => (
                        <div key={i} className="text-xs p-2 bg-slate-700/30 rounded flex justify-between">
                          <span>
                            <span className="text-slate-500">{t.date}</span>{' '}
                            <span className="font-medium">{t.symbol}</span>
                          </span>
                          <span className={t.outcome === 'WIN' ? 'text-emerald-400' : t.outcome === 'LOSS' ? 'text-red-400' : 'text-slate-400'}>
                            {t.pnlPercent >= 0 ? '+' : ''}{t.pnlPercent.toFixed(2)}% (${t.pnlDollars.toFixed(2)})
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4 md:space-y-6">
          {/* Recent Trades */}
          <div className="bg-slate-800/80 rounded-xl p-4 md:p-5 border border-slate-700/50">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold">Recent Trades</h2>
              <NavLink to="/history" className="text-xs text-emerald-400 hover:underline">View All</NavLink>
            </div>
            {displayTrades.length === 0 ? (
              <p className="text-sm text-slate-500">No trades yet</p>
            ) : (
              <div className="space-y-2">
                {displayTrades.slice(0, 6).map((trade) => (
                  <div key={trade.id} className="flex justify-between items-center p-2.5 bg-slate-700/40 rounded-lg">
                    <div>
                      <span className="font-medium text-sm">{trade.symbol}</span>
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                        trade.type === 'buy' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'
                      }`}>
                        {trade.type.toUpperCase()}
                      </span>
                      <p className="text-xs text-slate-500 mt-0.5">{new Date(trade.date).toLocaleString()}</p>
                    </div>
                    <div className="text-right text-sm">
                      <p>{trade.shares} @ ${trade.price.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ORB Scanner */}
          {github.isConfigured() && orbStatus && (
            <div className="bg-slate-800/80 rounded-xl p-4 md:p-5 border border-slate-700/50">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">ORB Scanner</h2>
                <div className="flex items-center gap-2">
                  {orbStatus.running && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    orbStatus.running ? 'bg-emerald-900/50 text-emerald-400' :
                    orbStatus.state === 'disabled' ? 'bg-slate-700 text-slate-400' :
                    'bg-slate-700 text-slate-300'
                  }`}>
                    {orbStatus.running ? 'Running' : orbStatus.state === 'disabled' ? 'Off' : 'Idle'}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {orbStatus.state === 'active' ? 'Weekdays 9:30 AM ET' : 'Paused'}
                </span>
                <button
                  onClick={handleOrbToggle}
                  disabled={orbStatusBusy}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                    orbStatus.state === 'active' ? 'bg-emerald-600' : 'bg-slate-600'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    orbStatus.state === 'active' ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700 flex items-center justify-between">
                <span className="text-xs text-slate-500">{watchlist.length} symbols</span>
                <button onClick={handleOrbSyncWatchlist} className="text-xs text-emerald-400 hover:underline">
                  Sync Watchlist
                </button>
              </div>
              {orbSyncMsg && (
                <p className={`text-xs mt-1 ${orbSyncMsg.includes('failed') || orbSyncMsg.includes('needs') ? 'text-red-400' : 'text-emerald-400'}`}>
                  {orbSyncMsg}
                </p>
              )}
            </div>
          )}

          {/* Watchlist */}
          <WatchlistCard />
        </div>
      </div>
    </div>
  );
}
