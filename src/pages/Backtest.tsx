import { useState } from 'react';
import { useStore } from '../store/useStore';
import { runBacktest } from '../services/backtester';
import type { BacktestResult } from '../types';

export function Backtest() {
  const { tradingRules, backtestResults, addBacktestResult, removeBacktestResult, clearBacktestResults } = useStore();

  const [symbol, setSymbol] = useState('AAPL');
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 3); // ~100 trading days available with free API
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [initialCapital, setInitialCapital] = useState('10000');
  const [positionSize, setPositionSize] = useState('10');
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeResult, setActiveResult] = useState<BacktestResult | null>(null);

  const patternRules = tradingRules.filter((r) => r.ruleType === 'pattern' && r.enabled);

  const toggleRule = (ruleId: string) => {
    const newSet = new Set(selectedRuleIds);
    if (newSet.has(ruleId)) {
      newSet.delete(ruleId);
    } else {
      newSet.add(ruleId);
    }
    setSelectedRuleIds(newSet);
  };

  const selectAllRules = () => {
    const symbolRules = patternRules.filter((r) => r.symbol.toUpperCase() === symbol.toUpperCase());
    setSelectedRuleIds(new Set(symbolRules.map((r) => r.id)));
  };

  const handleRunBacktest = async () => {
    if (selectedRuleIds.size === 0) {
      setError('Please select at least one rule to test');
      return;
    }

    setIsRunning(true);
    setError(null);

    try {
      const selectedRules = tradingRules.filter((r) => selectedRuleIds.has(r.id));
      const result = await runBacktest({
        symbol: symbol.toUpperCase(),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        initialCapital: parseFloat(initialCapital),
        positionSize: parseFloat(positionSize),
        rules: selectedRules,
      });

      addBacktestResult(result);
      setActiveResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed');
    } finally {
      setIsRunning(false);
    }
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

  const formatPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

  const formatDate = (date: Date) => new Date(date).toLocaleDateString();

  return (
    <div className="text-white">
      <div className="flex justify-between items-center mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold">Backtesting</h1>
        {backtestResults.length > 0 && (
          <button
            onClick={clearBacktestResults}
            className="text-slate-400 hover:text-slate-300 text-sm"
          >
            Clear History
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            <h2 className="text-lg md:text-xl font-semibold mb-4">Configuration</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 md:px-4 py-2 text-sm md:text-base focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-2">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 md:px-4 py-2 text-sm md:text-base focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-2">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 md:px-4 py-2 text-sm md:text-base focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-2">Initial Capital</label>
                  <input
                    type="number"
                    value={initialCapital}
                    onChange={(e) => setInitialCapital(e.target.value)}
                    min="100"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 md:px-4 py-2 text-sm md:text-base focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-2">Position Size %</label>
                  <input
                    type="number"
                    value={positionSize}
                    onChange={(e) => setPositionSize(e.target.value)}
                    min="1"
                    max="100"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 md:px-4 py-2 text-sm md:text-base focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-slate-400">Rules to Test</label>
                  <button
                    onClick={selectAllRules}
                    className="text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    Select All for {symbol}
                  </button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {patternRules.length === 0 ? (
                    <p className="text-sm text-slate-500">No pattern rules configured</p>
                  ) : (
                    patternRules.map((rule) => (
                      <label
                        key={rule.id}
                        className={`flex items-center gap-2 p-2 rounded cursor-pointer ${
                          selectedRuleIds.has(rule.id) ? 'bg-slate-700' : 'hover:bg-slate-700/50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedRuleIds.has(rule.id)}
                          onChange={() => toggleRule(rule.id)}
                          className="rounded border-slate-500"
                        />
                        <span className="text-sm flex-1">{rule.name}</span>
                        <span className="text-xs text-slate-500">{rule.symbol}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              {error && (
                <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              <button
                onClick={handleRunBacktest}
                disabled={isRunning}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 py-3 rounded-lg font-semibold transition-colors"
              >
                {isRunning ? 'Running Backtest...' : 'Run Backtest'}
              </button>
            </div>
          </div>

          {/* Previous Results */}
          {backtestResults.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-4 md:p-6 mt-3 md:mt-6">
              <h2 className="text-base md:text-lg font-semibold mb-4">Previous Results</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {backtestResults.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => setActiveResult(result)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      activeResult?.id === result.id
                        ? 'bg-slate-600'
                        : 'bg-slate-700 hover:bg-slate-600'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{result.config.symbol}</span>
                      <span
                        className={`text-sm ${
                          result.metrics.totalReturnPercent >= 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                        }`}
                      >
                        {formatPercent(result.metrics.totalReturnPercent)}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {formatDate(result.config.startDate)} - {formatDate(result.config.endDate)}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBacktestResult(result.id);
                        if (activeResult?.id === result.id) setActiveResult(null);
                      }}
                      className="absolute right-3 top-3 text-slate-500 hover:text-red-400"
                    >
                      x
                    </button>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2">
          {activeResult ? (
            <div className="space-y-3 md:space-y-6">
              {/* Metrics Grid */}
              <div className="bg-slate-800 rounded-xl p-4 md:p-6">
                <h2 className="text-lg md:text-xl font-semibold mb-4">
                  Results: {activeResult.config.symbol}
                  <span className="text-sm text-slate-400 font-normal ml-2">
                    {formatDate(activeResult.config.startDate)} - {formatDate(activeResult.config.endDate)}
                  </span>
                </h2>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                  <MetricCard
                    label="Total Return"
                    value={formatCurrency(activeResult.metrics.totalReturn)}
                    subValue={formatPercent(activeResult.metrics.totalReturnPercent)}
                    positive={activeResult.metrics.totalReturn >= 0}
                  />
                  <MetricCard
                    label="Win Rate"
                    value={`${activeResult.metrics.winRate.toFixed(1)}%`}
                    subValue={`${activeResult.metrics.winningTrades}/${activeResult.metrics.totalTrades} trades`}
                    positive={activeResult.metrics.winRate >= 50}
                  />
                  <MetricCard
                    label="Profit Factor"
                    value={activeResult.metrics.profitFactor === Infinity ? 'N/A' : activeResult.metrics.profitFactor.toFixed(2)}
                    subValue="Gross profit / loss"
                    positive={activeResult.metrics.profitFactor > 1}
                  />
                  <MetricCard
                    label="Max Drawdown"
                    value={formatCurrency(activeResult.metrics.maxDrawdown)}
                    subValue={formatPercent(-activeResult.metrics.maxDrawdownPercent)}
                    positive={false}
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mt-3 md:mt-4">
                  <MetricCard
                    label="Final Capital"
                    value={formatCurrency(activeResult.metrics.finalCapital)}
                    subValue={`Started with ${formatCurrency(activeResult.config.initialCapital)}`}
                    positive={activeResult.metrics.finalCapital >= activeResult.config.initialCapital}
                  />
                  <MetricCard
                    label="Avg Win"
                    value={formatCurrency(activeResult.metrics.averageWin)}
                    subValue={`Largest: ${formatCurrency(activeResult.metrics.largestWin)}`}
                    positive={true}
                  />
                  <MetricCard
                    label="Avg Loss"
                    value={formatCurrency(activeResult.metrics.averageLoss)}
                    subValue={`Largest: ${formatCurrency(activeResult.metrics.largestLoss)}`}
                    positive={false}
                  />
                  <MetricCard
                    label="Avg Hold Period"
                    value={`${activeResult.metrics.averageHoldingPeriod.toFixed(1)} days`}
                    subValue={`${activeResult.metrics.totalTrades} total trades`}
                    positive={true}
                    neutral
                  />
                </div>
              </div>

              {/* Equity Curve */}
              {activeResult.equityCurve && activeResult.equityCurve.length > 0 && (
                <div className="bg-slate-800 rounded-xl p-4 md:p-6">
                  <h3 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Equity Curve</h3>
                  <div className="h-36 md:h-48 flex items-end gap-0.5 md:gap-1">
                    {sampleEquityCurve(activeResult.equityCurve, 50).map((point, i, arr) => {
                      const min = Math.min(...arr.map((p) => p.equity));
                      const max = Math.max(...arr.map((p) => p.equity));
                      const range = max - min || 1;
                      const height = ((point.equity - min) / range) * 100;
                      const isProfit = point.equity >= activeResult.config.initialCapital;

                      return (
                        <div
                          key={i}
                          className={`flex-1 rounded-t transition-all ${
                            isProfit ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                          style={{ height: `${Math.max(height, 2)}%` }}
                          title={`${formatDate(point.date)}: ${formatCurrency(point.equity)}`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mt-2">
                    <span>{formatDate(activeResult.equityCurve[0].date)}</span>
                    <span>{formatDate(activeResult.equityCurve[activeResult.equityCurve.length - 1].date)}</span>
                  </div>
                </div>
              )}

              {/* Trades List */}
              <div className="bg-slate-800 rounded-xl p-4 md:p-6">
                <h3 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Trade History</h3>
                {activeResult.trades.length === 0 ? (
                  <p className="text-slate-400">No trades executed during this period</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 border-b border-slate-700">
                          <th className="text-left py-2">Rule</th>
                          <th className="text-left py-2">Pattern</th>
                          <th className="text-right py-2">Entry</th>
                          <th className="text-right py-2">Exit</th>
                          <th className="text-right py-2">Shares</th>
                          <th className="text-right py-2">P/L</th>
                          <th className="text-right py-2">Hold</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeResult.trades.slice(0, 20).map((trade) => (
                          <tr key={trade.id} className="border-b border-slate-700/50">
                            <td className="py-2">{trade.ruleName.substring(0, 20)}</td>
                            <td className="py-2 text-purple-400">{trade.pattern}</td>
                            <td className="py-2 text-right">
                              <div>${trade.entryPrice.toFixed(2)}</div>
                              <div className="text-xs text-slate-500">{formatDate(trade.entryDate)}</div>
                            </td>
                            <td className="py-2 text-right">
                              <div>${trade.exitPrice?.toFixed(2) || '-'}</div>
                              <div className="text-xs text-slate-500">
                                {trade.exitDate ? formatDate(trade.exitDate) : '-'}
                              </div>
                            </td>
                            <td className="py-2 text-right">{trade.shares}</td>
                            <td
                              className={`py-2 text-right ${
                                (trade.profitLoss || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            >
                              <div>{formatCurrency(trade.profitLoss || 0)}</div>
                              <div className="text-xs">{formatPercent(trade.profitLossPercent || 0)}</div>
                            </td>
                            <td className="py-2 text-right">{trade.holdingPeriodDays || 0}d</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {activeResult.trades.length > 20 && (
                      <p className="text-center text-slate-500 mt-4 text-sm">
                        Showing 20 of {activeResult.trades.length} trades
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-800 rounded-xl p-12 text-center">
              <div className="text-6xl mb-4">📊</div>
              <h2 className="text-xl font-semibold mb-2">Run a Backtest</h2>
              <p className="text-slate-400">
                Configure your backtest parameters and select the rules you want to test.
                Results will appear here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subValue,
  positive,
  neutral,
}: {
  label: string;
  value: string;
  subValue: string;
  positive: boolean;
  neutral?: boolean;
}) {
  return (
    <div className="bg-slate-700 rounded-lg p-4">
      <div className="text-sm text-slate-400">{label}</div>
      <div
        className={`text-xl font-semibold ${
          neutral ? 'text-white' : positive ? 'text-emerald-400' : 'text-red-400'
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-slate-500">{subValue}</div>
    </div>
  );
}

function sampleEquityCurve(curve: { date: Date; equity: number }[], maxPoints: number) {
  if (curve.length <= maxPoints) return curve;
  const step = Math.ceil(curve.length / maxPoints);
  return curve.filter((_, i) => i % step === 0);
}
