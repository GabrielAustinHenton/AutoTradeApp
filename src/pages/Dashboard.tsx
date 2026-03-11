import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { github } from '../services/github';
import type { OrbScannerStatus } from '../services/github';
import { WatchlistCard } from '../components/portfolio/WatchlistCard';
import { runBacktest, runRSIBacktest, runHybridBacktest, runDayTradingBacktest, type DayTradeResult } from '../services/backtester';
import type { BacktestResult } from '../types';
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
    tradingRules,
    watchlist,
    tradingMode,
    paperPortfolio,
    alpacaConnected,
    alpacaSynced,
    alpacaPaperConnected,
    alpacaLiveConnected,
    syncFromAlpaca,
  } = useStore();

  // Backtest state
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestSymbol, setBacktestSymbol] = useState('AAPL');
  const [backtestStrategy, setBacktestStrategy] = useState<'hybrid' | 'rsi' | 'pattern' | 'daytrade'>('daytrade');

  // Day trading backtest state
  const [dayTradeResult, setDayTradeResult] = useState<DayTradeResult | null>(null);
  const [backtestYears, setBacktestYears] = useState<string>('1'); // '1', '2', '5', '10', '20', or specific year like '2020'
  const [realisticCosts, setRealisticCosts] = useState<boolean>(true); // Include slippage/fees

  // Use paper portfolio data when in paper mode
  const isPaperMode = tradingMode === 'paper';
  const isLiveNotConnected = tradingMode === 'live' && (!alpacaConnected || !alpacaSynced);
  const displayPositions = isPaperMode ? (paperPortfolio?.positions || []) : (isLiveNotConnected ? [] : positions);
  // cashBalance = account.cash (uninvested); buyingPower = account.buying_power (tradable incl. margin)
  const displayCash = isPaperMode ? (paperPortfolio?.cashBalance ?? 10000) : (isLiveNotConnected ? null : cashBalance);
  const displayBuyingPower = isPaperMode
    ? (paperPortfolio?.buyingPower ?? paperPortfolio?.cashBalance ?? 10000)
    : displayCash;
  const displayTrades = isPaperMode ? (paperPortfolio?.trades || []) : (isLiveNotConnected ? [] : trades);

  // Sync from Alpaca every 60s to keep positions and prices fresh
  useEffect(() => {
    const interval = setInterval(() => {
      syncFromAlpaca().catch(() => {/* silent — already logged in store */});
    }, 60_000);
    return () => clearInterval(interval);
  }, [syncFromAlpaca]);

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

  const handleOrbStop = async () => {
    if (!orbStatus?.runId || orbStatusBusy) return;
    setOrbStatusBusy(true);
    try {
      await github.cancelOrbRun(orbStatus.runId);
      await new Promise(r => setTimeout(r, 2000));
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
      setOrbSyncMsg(`Synced ${watchlist.length} symbols to scanner`);
      setTimeout(() => setOrbSyncMsg(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      setOrbSyncMsg(msg.includes('403') || msg.includes('404')
        ? 'PAT needs Contents permission — regenerate token'
        : `Sync failed: ${msg}`);
    }
  };

  const totalPositionValue = displayPositions.reduce((sum, p) => sum + p.totalValue, 0);
  const totalPortfolioValue = isLiveNotConnected ? null : totalPositionValue + (displayCash ?? 0);
  // Day change comes from Alpaca account (equity - last_equity), stored on each sync
  const dayChange = isLiveNotConnected ? null
    : isPaperMode ? (paperPortfolio?.dayChange ?? null)
    : (portfolioSummary?.dayChange ?? null);

  // Calculate portfolio performance from history (works for both paper and live modes)
  const chartData = useMemo(() => {
    // Paper mode: use paperPortfolio.history
    // Live mode: use portfolioSummary.portfolioHistory
    const history = isPaperMode
      ? paperPortfolio?.history
      : portfolioSummary?.portfolioHistory;

    if (!history || history.length === 0) return [];

    // Group snapshots by date and take the last value of each day
    const dailyData = new Map<string, number>();
    history.forEach((snapshot) => {
      const date = new Date(snapshot.date);
      const dateKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dailyData.set(dateKey, snapshot.totalValue);
    });

    return Array.from(dailyData.entries()).map(([date, value]) => ({
      date,
      value,
    }));
  }, [isPaperMode, paperPortfolio?.history, portfolioSummary?.portfolioHistory]);

  // Calculate P&L stats — total account gain from starting balance
  const startingBalance = isPaperMode ? (paperPortfolio?.startingBalance ?? 100000) : null;
  // For paper: total P&L from starting balance. For live: use Alpaca portfolio history first equity.
  const totalPnL = (() => {
    if (isLiveNotConnected || totalPortfolioValue === null) return null;
    if (isPaperMode && startingBalance !== null) {
      return totalPortfolioValue - startingBalance;
    }
    // Live mode: compute from portfolio history if available
    const liveHistory = portfolioSummary?.portfolioHistory;
    if (liveHistory && liveHistory.length > 0) {
      return totalPortfolioValue - liveHistory[0].totalValue;
    }
    // Fallback: unrealized P/L from positions
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

  // Quick Backtest function
  const runQuickBacktest = async () => {
    setBacktestRunning(true);
    setBacktestError(null);
    setBacktestResult(null);
    setDayTradeResult(null);

    try {
      if (backtestStrategy === 'daytrade') {
        // Day Trading Strategy - scans ALL watchlist stocks
        // Parse year selection
        const isSpecificYear = backtestYears.length === 4 && !isNaN(parseInt(backtestYears));
        const yearsBack = isSpecificYear ? 20 : parseInt(backtestYears);
        const specificYear = isSpecificYear ? parseInt(backtestYears) : undefined;

        const result = await runDayTradingBacktest(
          watchlist,
          25000,  // $25k starting capital (PDT minimum)
          25,     // 25% position size (scales down as portfolio grows)
          2,      // 2% profit target
          1,      // 1% stop loss
          yearsBack,
          specificYear,
          0,                          // $0 commission (like Robinhood)
          realisticCosts ? 0.02 : 0,  // 0.02% slippage per side (realistic for liquid large-caps)
          15,                         // 15% yearly drawdown limit - stop trading if hit
          tradingMode === 'paper',
        );
        setDayTradeResult(result);
      } else {
        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setFullYear(startDate.getFullYear() - 1);

        const config = {
          symbol: backtestSymbol.toUpperCase(),
          startDate,
          endDate,
          initialCapital: 10000,
          positionSize: 20,
          isPaper: tradingMode === 'paper',
          rules: tradingRules.filter(
            (r) => r.enabled && r.ruleType === 'pattern' && (!r.symbol || r.symbol.toUpperCase() === backtestSymbol.toUpperCase())
          ),
        };

        let result;
        if (backtestStrategy === 'hybrid') {
          result = await runHybridBacktest(config);
        } else if (backtestStrategy === 'rsi') {
          result = await runRSIBacktest(config);
        } else {
          if (config.rules.length === 0) {
            throw new Error(`No enabled pattern rules found for ${backtestSymbol}`);
          }
          result = await runBacktest(config);
        }

        setBacktestResult(result);
      }
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setBacktestRunning(false);
    }
  };

  return (
    <div className="text-white">
      <div className="flex flex-row justify-between items-center gap-3 mb-6 md:mb-8">
        <div className="flex items-center gap-2 md:gap-4 flex-wrap">
          <h1 className="text-2xl md:text-3xl font-bold">Welcome To AutoTrader</h1>
          <span className={`px-2 py-0.5 md:px-3 md:py-1 rounded-full text-xs md:text-sm font-medium ${
            isPaperMode ? 'bg-amber-900 text-amber-300' : 'bg-emerald-900 text-emerald-300'
          }`}>
            {isPaperMode ? 'PAPER' : 'LIVE'}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <NavLink
            to="/swing-trader"
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-medium transition-colors"
          >
            🔄 SwingTrader App
          </NavLink>
        </div>
      </div>

      {isLiveNotConnected && (
        <div className="mb-6 p-4 bg-slate-800 border border-slate-600 rounded-xl text-center">
          <p className="text-slate-400">Not connected. Connect Alpaca in Settings to see live portfolio data.</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-8">
        <StatCard
          title="Portfolio Value"
          value={totalPortfolioValue !== null ? `$${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          subtitle={isLiveNotConnected ? 'Not connected' : 'Total assets'}
        />
        <StatCard
          title="Buying Power"
          value={displayBuyingPower !== null ? `$${displayBuyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          subtitle={isLiveNotConnected ? 'Not connected' : 'Available to trade'}
        />
        <StatCard
          title="Total Gain/Loss"
          value={totalPnL !== null ? `$${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          subtitle={isLiveNotConnected ? 'Not connected' : (totalPnL !== null && totalPnL >= 0 ? 'All-time profit' : 'All-time loss')}
          valueColor={totalPnL !== null ? (totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined}
        />
        <StatCard
          title="Day Change"
          value={dayChange !== null ? `$${dayChange.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          subtitle={isLiveNotConnected ? 'Not connected' : "Today's P&L"}
          valueColor={dayChange !== null ? (dayChange >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg md:text-xl font-semibold">Portfolio Performance</h2>
              <div className="text-right">
                {totalPnL !== null && !isLiveNotConnected ? (
                  <>
                    <div className={`text-lg font-semibold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className={`text-sm ${(totalPnLPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(totalPnLPercent ?? 0) >= 0 ? '+' : ''}{(totalPnLPercent ?? 0).toFixed(2)}% since start
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400">--</div>
                )}
              </div>
            </div>
            <div className="h-48 md:h-64">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                    <YAxis
                      stroke="#9ca3af"
                      fontSize={12}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
                      domain={['dataMin - 500', 'dataMax + 500']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: 'none',
                        borderRadius: '8px',
                      }}
                      formatter={(value: number) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 'Value']}
                    />
                    {startingBalance !== null && <ReferenceLine y={startingBalance} stroke="#64748b" strokeDasharray="5 5" />}
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
                <div className="h-full flex items-center justify-center text-slate-400">
                  <div className="text-center">
                    <p>No performance data yet</p>
                    <p className="text-sm mt-1">Make some trades to see your portfolio chart</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Backtest */}
          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            <h2 className="text-lg md:text-xl font-semibold mb-4">Quick Backtest</h2>
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                {backtestStrategy !== 'daytrade' && (
                  <input
                    type="text"
                    value={backtestSymbol}
                    onChange={(e) => setBacktestSymbol(e.target.value.toUpperCase())}
                    placeholder="Symbol"
                    className="w-24 px-3 py-2 bg-slate-700 rounded-lg text-sm"
                  />
                )}
                {backtestStrategy === 'daytrade' && (
                  <>
                    <select
                      value={backtestYears}
                      onChange={(e) => setBacktestYears(e.target.value)}
                      className="px-3 py-2 bg-slate-700 rounded-lg text-sm"
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
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={realisticCosts}
                        onChange={(e) => setRealisticCosts(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-slate-400">Costs</span>
                    </label>
                  </>
                )}
                <select
                  value={backtestStrategy}
                  onChange={(e) => setBacktestStrategy(e.target.value as 'hybrid' | 'rsi' | 'pattern' | 'daytrade')}
                  className="flex-1 px-3 py-2 bg-slate-700 rounded-lg text-sm"
                >
                  <option value="daytrade">Day Trading (All Stocks)</option>
                  <option value="hybrid">Trend Following</option>
                  <option value="rsi">RSI(14) Classic</option>
                  <option value="pattern">Pattern Rules</option>
                </select>
                <button
                  onClick={runQuickBacktest}
                  disabled={backtestRunning}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 rounded-lg text-sm font-medium transition-colors"
                >
                  {backtestRunning ? 'Running...' : 'Run'}
                </button>
              </div>
              <p className="text-xs text-slate-500">
                {backtestStrategy === 'daytrade'
                  ? `ORB Strategy: ${watchlist.length} stocks, ${backtestYears.length === 4 ? backtestYears : backtestYears + ' yr'}. 25% position, 2% target, 1% stop.${realisticCosts ? ' 0.2% slippage.' : ''} $25k start, scales down at $100k+, goal: $500k.`
                  : backtestStrategy === 'hybrid'
                  ? 'Long-only trend following with 200 MA filter'
                  : backtestStrategy === 'rsi'
                  ? 'RSI(14) < 30 = Buy, RSI > 70 = Sell, 5% stop loss'
                  : 'Tests with your pattern rules'}
              </p>

              {backtestStrategy === 'daytrade' && !(isPaperMode ? alpacaPaperConnected : alpacaLiveConnected) && (
                <div className="p-3 bg-amber-900/40 border border-amber-700 rounded-lg text-sm text-amber-300">
                  Alpaca account not connected. Go to Settings → Alpaca Markets to connect your {isPaperMode ? 'paper' : 'live'} account first.
                </div>
              )}

              {backtestError && (
                <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-sm text-red-300">
                  {backtestError}
                </div>
              )}

              {backtestResult && (
                <div className="space-y-2 pt-2 border-t border-slate-700">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Total Trades</span>
                    <span>{backtestResult.metrics.totalTrades}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Win Rate</span>
                    <span className={backtestResult.metrics.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>
                      {backtestResult.metrics.winRate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Total Return</span>
                    <span className={backtestResult.metrics.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {backtestResult.metrics.totalReturn >= 0 ? '+' : ''}${backtestResult.metrics.totalReturn.toFixed(2)}
                      {' '}({backtestResult.metrics.totalReturnPercent >= 0 ? '+' : ''}{backtestResult.metrics.totalReturnPercent.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Max Drawdown</span>
                    <span className="text-red-400">-${backtestResult.metrics.maxDrawdown.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Profit Factor</span>
                    <span>{backtestResult.metrics.profitFactor === Infinity ? '∞' : backtestResult.metrics.profitFactor.toFixed(2)}</span>
                  </div>
                  {backtestResult.trades.length > 0 && (
                    <details className="pt-2">
                      <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300">
                        View {backtestResult.trades.length} trades
                      </summary>
                      <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                        {backtestResult.trades.map((t, i) => (
                          <div key={i} className="text-xs p-2 bg-slate-700/50 rounded">
                            <div className="flex justify-between">
                              <span>{t.ruleName}</span>
                              <span className={t.profitLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                {t.profitLoss >= 0 ? '+' : ''}${t.profitLoss.toFixed(2)}
                              </span>
                            </div>
                            <div className="text-slate-500">
                              ${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {dayTradeResult && (
                <div className="space-y-2 pt-2 border-t border-slate-700">
                  <div className="flex justify-between text-sm font-semibold">
                    <span className="text-slate-300">Day Trading Results</span>
                    <span className={dayTradeResult.totalReturnPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      ${dayTradeResult.initialCapital.toFixed(0)} → ${dayTradeResult.finalCapital.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Total Return</span>
                    <span className={dayTradeResult.totalReturnPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {dayTradeResult.totalReturnPercent >= 0 ? '+' : ''}{dayTradeResult.totalReturnPercent.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Total Trades</span>
                    <span>{dayTradeResult.totalTrades}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Win Rate</span>
                    <span className={dayTradeResult.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}>
                      {dayTradeResult.winRate.toFixed(1)}% ({dayTradeResult.winningTrades}W / {dayTradeResult.losingTrades}L)
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Avg Win / Loss</span>
                    <span>
                      <span className="text-emerald-400">+{dayTradeResult.avgWinPercent.toFixed(2)}%</span>
                      {' / '}
                      <span className="text-red-400">{dayTradeResult.avgLossPercent.toFixed(2)}%</span>
                    </span>
                  </div>
                  {dayTradeResult.totalCosts > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Transaction Costs</span>
                      <span className="text-orange-400">-${dayTradeResult.totalCosts.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Best / Worst Day</span>
                    <span>
                      <span className="text-emerald-400">+{dayTradeResult.bestDay.toFixed(2)}%</span>
                      {' / '}
                      <span className="text-red-400">{dayTradeResult.worstDay.toFixed(2)}%</span>
                    </span>
                  </div>

                  {/* Realistic Estimate with Haircut */}
                  <div className="mt-3 p-3 bg-slate-800/50 border border-slate-600 rounded-lg">
                    <div className="flex justify-between text-sm font-semibold mb-2">
                      <span className="text-amber-400">Realistic Estimate</span>
                      <span className={dayTradeResult.realisticReturnPercent >= 0 ? 'text-amber-400' : 'text-red-400'}>
                        {dayTradeResult.realisticReturnPercent >= 0 ? '+' : ''}{dayTradeResult.realisticReturnPercent.toFixed(1)}%
                        {' '}(${dayTradeResult.realisticFinalCapital.toFixed(0)})
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mb-2">
                      Haircut applied: -{dayTradeResult.haircutPercent.toFixed(0)}% for real-world factors
                    </div>
                    <details className="text-xs">
                      <summary className="text-slate-500 cursor-pointer hover:text-slate-400">
                        Why the adjustment?
                      </summary>
                      <ul className="mt-2 space-y-1 text-slate-400">
                        {dayTradeResult.haircutReasons.map((reason, i) => (
                          <li key={i}>• {reason}</li>
                        ))}
                      </ul>
                    </details>
                  </div>

                  {dayTradeResult.goalReached && (
                    <div className="p-3 bg-emerald-900/50 border border-emerald-500 rounded-lg">
                      <div className="flex items-center gap-2 text-emerald-400 font-bold">
                        <span>Goal Reached: $500,000</span>
                      </div>
                      <div className="text-sm text-emerald-300 mt-2">
                        Congratulations! You reached the $500k goal on {dayTradeResult.goalReachedDate}.
                      </div>
                      <div className="text-xs text-slate-300 mt-3 space-y-1">
                        <div className="font-medium">Recommended next steps:</div>
                        <div>1. Move 80% ($400k) to index funds (VOO, VTI) for long-term growth</div>
                        <div>2. Keep 10% ($50k) for swing trading with larger positions</div>
                        <div>3. Reserve 10% ($50k) as emergency cash buffer</div>
                        <div>4. Consider consulting a financial advisor for tax optimization</div>
                      </div>
                    </div>
                  )}
                  {dayTradeResult.drawdownStopTriggered && !dayTradeResult.goalReached && (
                    <div className="p-2 bg-yellow-900/30 border border-yellow-700 rounded-lg text-sm">
                      <div className="flex items-center gap-2 text-yellow-400">
                        <span>Drawdown Protection Triggered</span>
                      </div>
                      <div className="text-xs text-yellow-400/70 mt-1">
                        Stopped trading on {dayTradeResult.drawdownStopDate} (down 15% from year start).
                        Saved from {dayTradeResult.tradesSkippedDueToDrawdown} potential additional trades.
                      </div>
                    </div>
                  )}
                  {dayTradeResult.trades.length > 0 && (
                    <details className="pt-2">
                      <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300">
                        View {dayTradeResult.trades.length} trades
                      </summary>
                      <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
                        {dayTradeResult.trades.slice(-50).map((t, i) => (
                          <div key={i} className="text-xs p-2 bg-slate-700/50 rounded flex justify-between">
                            <span>
                              <span className="text-slate-500">{t.date}</span>
                              {' '}
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

          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            <h2 className="text-lg md:text-xl font-semibold mb-4">Positions</h2>
            {displayPositions.filter(p => p.shares > 0).length === 0 ? (
              <p className="text-slate-400">No positions yet. Start trading to build your portfolio.</p>
            ) : (
              <div className="space-y-3">
                {displayPositions.filter(p => p.shares > 0).map((position) => {
                  const isPositive = position.totalGain >= 0;

                  return (
                    <div
                      key={position.id}
                      className="flex justify-between items-center p-3 md:p-4 bg-slate-700 rounded-lg"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold md:text-lg">{position.symbol}</div>
                        <div className="text-xs md:text-sm text-slate-400">
                          {position.shares} @ ${position.avgCost.toFixed(2)}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div className="font-semibold text-sm md:text-base">
                          ${position.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs md:text-sm">
                          <span className={isPositive ? 'text-emerald-400' : 'text-red-400'}>
                            {isPositive ? '+' : ''}${position.totalGain.toFixed(2)} ({isPositive ? '+' : ''}{position.totalGainPercent.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        <div className="space-y-4 md:space-y-6">
          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            <h2 className="text-lg md:text-xl font-semibold mb-4">Recent Trades</h2>
            {displayTrades.length === 0 ? (
              <p className="text-slate-400">No trades yet</p>
            ) : (
              <div className="space-y-3">
                {displayTrades.slice(0, 5).map((trade) => (
                  <div
                    key={trade.id}
                    className="flex justify-between items-center p-3 bg-slate-700 rounded-lg"
                  >
                    <div>
                      <span className="font-semibold">{trade.symbol}</span>
                      <span
                        className={`ml-2 text-sm ${
                          trade.type === 'buy' ? 'text-emerald-400' :
                          trade.type === 'short' ? 'text-purple-400' :
                          trade.type === 'cover' ? 'text-amber-400' : 'text-red-400'
                        }`}
                      >
                        {trade.type.toUpperCase()}
                      </span>
                      <div className="text-xs text-slate-500">
                        {new Date(trade.date).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div>{trade.shares} shares</div>
                      <div className="text-sm text-slate-400">
                        @ ${trade.price.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {github.isConfigured() && orbStatus && (
            <div className="bg-slate-800 rounded-xl p-4 md:p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">ORB Scanner</h2>
                <div className="flex items-center gap-2">
                  {orbStatus.running && (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  )}
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    orbStatus.running
                      ? 'bg-emerald-900 text-emerald-300'
                      : orbStatus.state === 'disabled'
                      ? 'bg-slate-700 text-slate-400'
                      : 'bg-slate-700 text-slate-300'
                  }`}>
                    {orbStatus.running ? 'Running' : orbStatus.state === 'disabled' ? 'Disabled' : 'Idle'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">
                  {orbStatus.state === 'active' ? 'Scheduled weekdays 9:30 AM ET' : 'Cron paused'}
                </span>
                <div className="flex gap-2">
                  {orbStatus.running && (
                    <button
                      onClick={handleOrbStop}
                      disabled={orbStatusBusy}
                      className="px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-xs font-medium transition-colors"
                    >
                      Stop
                    </button>
                  )}
                  <button
                    onClick={handleOrbToggle}
                    disabled={orbStatusBusy}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                      orbStatus.state === 'active' ? 'bg-emerald-600' : 'bg-slate-600'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      orbStatus.state === 'active' ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-700 flex items-center justify-between">
                <span className="text-xs text-slate-500">{watchlist.length} symbols in watchlist</span>
                <button
                  onClick={handleOrbSyncWatchlist}
                  className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors"
                >
                  Sync Watchlist
                </button>
              </div>
              {orbSyncMsg && (
                <p className={`text-xs mt-2 ${orbSyncMsg.includes('failed') || orbSyncMsg.includes('needs') ? 'text-red-400' : 'text-emerald-400'}`}>
                  {orbSyncMsg}
                </p>
              )}
            </div>
          )}

          <WatchlistCard />

          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            <h2 className="text-lg md:text-xl font-semibold mb-4">Trading Rules</h2>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Active Rules</span>
                <span className="font-semibold text-emerald-400">
                  {tradingRules.filter((r) => r.enabled).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Rules</span>
                <span>{tradingRules.length}</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  valueColor = 'text-white',
}: {
  title: string;
  value: string;
  subtitle: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-slate-800 rounded-xl p-3 md:p-6">
      <h3 className="text-slate-400 text-[11px] md:text-sm mb-1 md:mb-2 truncate">{title}</h3>
      <p className={`text-lg md:text-2xl font-bold ${valueColor} truncate`}>{value}</p>
      <p className="text-slate-500 text-[10px] md:text-sm mt-0.5 md:mt-1 truncate">{subtitle}</p>
    </div>
  );
}
