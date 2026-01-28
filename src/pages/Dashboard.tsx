import { useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useMultipleQuotes } from '../hooks/useStockData';
import { WatchlistCard } from '../components/portfolio/WatchlistCard';
import { AlertsPanel } from '../components/alerts/AlertsPanel';
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
    trades,
    tradingRules,
    updatePositionPrices,
    updatePaperPositionPrices,
    tradingMode,
    paperPortfolio,
    autoTradeConfig,
    requestScan,
    alertsEnabled,
    ibkrConnected,
  } = useStore();

  // Use paper portfolio data when in paper mode
  const isPaperMode = tradingMode === 'paper';
  const isLiveNotConnected = tradingMode === 'live' && !ibkrConnected;
  const displayPositions = isPaperMode ? (paperPortfolio?.positions || []) : (isLiveNotConnected ? [] : positions);
  const displayCash = isPaperMode ? (paperPortfolio?.cashBalance ?? 10000) : (isLiveNotConnected ? null : cashBalance);
  const displayTrades = isPaperMode ? (paperPortfolio?.trades || []) : (isLiveNotConnected ? [] : trades);

  // Get unique symbols from positions
  const positionSymbols = displayPositions.filter(p => p.shares > 0).map((p) => p.symbol);
  const { quotes, loading: quotesLoading } = useMultipleQuotes(positionSymbols, true);

  // Update position prices when quotes change
  useEffect(() => {
    if (quotes.size > 0) {
      const priceMap = new Map<string, number>();
      quotes.forEach((quote, symbol) => {
        priceMap.set(symbol, quote.price);
      });
      // Update the correct portfolio based on mode
      if (isPaperMode) {
        updatePaperPositionPrices(priceMap);
      } else {
        updatePositionPrices(priceMap);
      }
    }
  }, [quotes, updatePositionPrices, updatePaperPositionPrices, isPaperMode]);

  const totalPositionValue = displayPositions.reduce((sum, p) => sum + p.totalValue, 0);
  const totalPortfolioValue = isLiveNotConnected ? null : totalPositionValue + (displayCash ?? 0);
  const totalGain = isLiveNotConnected ? null : displayPositions.reduce((sum, p) => sum + p.totalGain, 0);
  const dayChange = isLiveNotConnected ? null : Array.from(quotes.values()).reduce(
    (sum, q) => sum + q.change * (displayPositions.find((p) => p.symbol === q.symbol)?.shares || 0),
    0
  );

  // Calculate portfolio performance from history
  const chartData = useMemo(() => {
    const history = paperPortfolio?.history;
    if (!isPaperMode || !history || history.length === 0) {
      return [];
    }

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
  }, [isPaperMode, paperPortfolio?.history]);

  // Calculate P&L stats
  const startingBalance = isPaperMode ? (paperPortfolio?.startingBalance ?? 10000) : 10000;
  const totalPnL = totalPortfolioValue !== null ? totalPortfolioValue - startingBalance : null;
  const totalPnLPercent = totalPnL !== null ? (totalPnL / startingBalance) * 100 : null;

  return (
    <div className="text-white">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            isPaperMode ? 'bg-amber-900 text-amber-300' : 'bg-emerald-900 text-emerald-300'
          }`}>
            {isPaperMode ? 'PAPER TRADING' : 'LIVE TRADING'}
          </span>
          {autoTradeConfig.enabled && (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-purple-900 text-purple-300">
              AUTO-TRADE ON
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {quotesLoading && (
            <span className="text-sm text-slate-400 animate-pulse">
              Updating prices...
            </span>
          )}
          <button
            onClick={requestScan}
            disabled={!alertsEnabled}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
          >
            Scan Now
          </button>
        </div>
      </div>

      {isLiveNotConnected && (
        <div className="mb-6 p-4 bg-slate-800 border border-slate-600 rounded-xl text-center">
          <p className="text-slate-400">IBKR not connected. Connect your broker in Settings to see live portfolio data.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Portfolio Value"
          value={totalPortfolioValue !== null ? `$${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          subtitle={isLiveNotConnected ? 'Not connected' : 'Total assets'}
        />
        <StatCard
          title="Cash Balance"
          value={displayCash !== null ? `$${displayCash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          subtitle={isLiveNotConnected ? 'Not connected' : 'Available to trade'}
        />
        <StatCard
          title="Total Gain/Loss"
          value={totalGain !== null ? `$${totalGain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          subtitle={isLiveNotConnected ? 'Not connected' : (totalGain !== null && totalGain >= 0 ? 'All-time profit' : 'All-time loss')}
          valueColor={totalGain !== null ? (totalGain >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined}
        />
        <StatCard
          title="Day Change"
          value={dayChange !== null ? `$${dayChange.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
          subtitle={isLiveNotConnected ? 'Not connected' : "Today's P&L"}
          valueColor={dayChange !== null ? (dayChange >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-800 rounded-xl p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Portfolio Performance</h2>
              <div className="text-right">
                {totalPnL !== null ? (
                  <>
                    <div className={`text-lg font-semibold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className={`text-sm ${(totalPnLPercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(totalPnLPercent ?? 0) >= 0 ? '+' : ''}{(totalPnLPercent ?? 0).toFixed(2)}% all-time
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400">--</div>
                )}
              </div>
            </div>
            <div className="h-64">
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
                    <ReferenceLine y={startingBalance} stroke="#64748b" strokeDasharray="5 5" />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={totalPnL >= 0 ? '#10b981' : '#ef4444'}
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

          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Positions</h2>
            {displayPositions.filter(p => p.shares > 0).length === 0 ? (
              <p className="text-slate-400">No positions yet. Start trading to build your portfolio.</p>
            ) : (
              <div className="space-y-3">
                {displayPositions.filter(p => p.shares > 0).map((position) => {
                  const quote = quotes.get(position.symbol);
                  const isPositive = position.totalGain >= 0;
                  const dayChangeAmount = quote ? quote.change * position.shares : 0;
                  const dayIsPositive = dayChangeAmount >= 0;

                  return (
                    <div
                      key={position.id}
                      className="flex justify-between items-center p-4 bg-slate-700 rounded-lg"
                    >
                      <div>
                        <div className="font-semibold text-lg">{position.symbol}</div>
                        <div className="text-sm text-slate-400">
                          {position.shares} shares @ ${position.avgCost.toFixed(2)} avg
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">
                          ${position.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="flex gap-3 text-sm">
                          <span className={isPositive ? 'text-emerald-400' : 'text-red-400'}>
                            {isPositive ? '+' : ''}${position.totalGain.toFixed(2)} ({position.totalGainPercent.toFixed(2)}%)
                          </span>
                          {quote && (
                            <span className={dayIsPositive ? 'text-emerald-400' : 'text-red-400'}>
                              Day: {dayIsPositive ? '+' : ''}${dayChangeAmount.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Recent Trades</h2>
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
        </div>

        <div className="space-y-6">
          <AlertsPanel />

          <WatchlistCard />

          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Trading Rules</h2>
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
    <div className="bg-slate-800 rounded-xl p-6">
      <h3 className="text-slate-400 text-sm mb-2">{title}</h3>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      <p className="text-slate-500 text-sm mt-1">{subtitle}</p>
    </div>
  );
}
