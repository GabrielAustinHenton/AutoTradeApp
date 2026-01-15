import { useEffect } from 'react';
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
} from 'recharts';

const mockChartData = [
  { date: 'Mon', value: 10000 },
  { date: 'Tue', value: 10250 },
  { date: 'Wed', value: 10180 },
  { date: 'Thu', value: 10420 },
  { date: 'Fri', value: 10650 },
];

export function Dashboard() {
  const { positions, cashBalance, trades, tradingRules, updatePositionPrices } = useStore();

  // Get unique symbols from positions
  const positionSymbols = positions.filter(p => p.shares > 0).map((p) => p.symbol);
  const { quotes, loading: quotesLoading } = useMultipleQuotes(positionSymbols, true);

  // Update position prices when quotes change
  useEffect(() => {
    if (quotes.size > 0) {
      const priceMap = new Map<string, number>();
      quotes.forEach((quote, symbol) => {
        priceMap.set(symbol, quote.price);
      });
      updatePositionPrices(priceMap);
    }
  }, [quotes, updatePositionPrices]);

  const totalPositionValue = positions.reduce((sum, p) => sum + p.totalValue, 0);
  const totalPortfolioValue = totalPositionValue + cashBalance;
  const totalGain = positions.reduce((sum, p) => sum + p.totalGain, 0);
  const dayChange = Array.from(quotes.values()).reduce(
    (sum, q) => sum + q.change * (positions.find((p) => p.symbol === q.symbol)?.shares || 0),
    0
  );

  return (
    <div className="text-white">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        {quotesLoading && (
          <span className="text-sm text-slate-400 animate-pulse">
            Updating prices...
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          title="Portfolio Value"
          value={`$${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtitle="Total assets"
        />
        <StatCard
          title="Cash Balance"
          value={`$${cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtitle="Available to trade"
        />
        <StatCard
          title="Total Gain/Loss"
          value={`$${totalGain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtitle={totalGain >= 0 ? 'All-time profit' : 'All-time loss'}
          valueColor={totalGain >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard
          title="Day Change"
          value={`$${dayChange.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtitle="Today's P&L"
          valueColor={dayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Portfolio Performance</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mockChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" stroke="#9ca3af" />
                  <YAxis stroke="#9ca3af" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1e293b',
                      border: 'none',
                      borderRadius: '8px',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Positions</h2>
            {positions.filter(p => p.shares > 0).length === 0 ? (
              <p className="text-slate-400">No positions yet. Start trading to build your portfolio.</p>
            ) : (
              <div className="space-y-3">
                {positions.filter(p => p.shares > 0).map((position) => {
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
            {trades.length === 0 ? (
              <p className="text-slate-400">No trades yet</p>
            ) : (
              <div className="space-y-3">
                {trades.slice(0, 5).map((trade) => (
                  <div
                    key={trade.id}
                    className="flex justify-between items-center p-3 bg-slate-700 rounded-lg"
                  >
                    <div>
                      <span className="font-semibold">{trade.symbol}</span>
                      <span
                        className={`ml-2 text-sm ${
                          trade.type === 'buy' ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {trade.type.toUpperCase()}
                      </span>
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
