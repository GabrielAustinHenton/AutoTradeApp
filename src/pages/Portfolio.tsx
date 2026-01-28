import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { Position, ShortPosition } from '../types';
import { getQuote } from '../services/alphaVantage';
import { exportToCSV, exportToJSON, exportToPrintableHTML } from '../utils/exportPortfolio';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function Portfolio() {
  const location = useLocation();
  const { positions, cashBalance, tradingMode, paperPortfolio, resetPaperPortfolio, updatePaperPositionPrices, updateShortPositionPrices, ibkrConnected } = useStore();
  const [activeTab, setActiveTab] = useState<'paper' | 'live'>(tradingMode);
  const isLiveNotConnected = activeTab === 'live' && !ibkrConnected;
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const hasRefreshedRef = useRef(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch live prices for paper positions (long and short)
  const refreshPaperPrices = useCallback(async () => {
    const shortPositions = paperPortfolio.shortPositions || [];
    if (paperPortfolio.positions.length === 0 && shortPositions.length === 0) return;

    setIsRefreshing(true);
    const prices = new Map<string, number>();

    // Collect all unique symbols from both long and short positions
    const allSymbols = new Set([
      ...paperPortfolio.positions.map(p => p.symbol),
      ...shortPositions.map(p => p.symbol)
    ]);

    for (const symbol of allSymbols) {
      try {
        const quote = await getQuote(symbol);
        if (quote && quote.price) {
          prices.set(symbol, quote.price);
        }
        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        console.error(`Failed to fetch price for ${symbol}:`, err);
      }
    }

    if (prices.size > 0) {
      updatePaperPositionPrices(prices);
      updateShortPositionPrices(prices);
      setLastUpdated(new Date());
    }
    setIsRefreshing(false);
  }, [paperPortfolio.positions, paperPortfolio.shortPositions, updatePaperPositionPrices, updateShortPositionPrices]);

  // Auto-refresh paper prices every time this page is navigated to
  useEffect(() => {
    // Reset the ref when location changes (new navigation)
    hasRefreshedRef.current = false;
  }, [location.key]);

  const hasAnyPositions = paperPortfolio.positions.length > 0 || (paperPortfolio.shortPositions?.length || 0) > 0;

  useEffect(() => {
    if (!hasRefreshedRef.current && activeTab === 'paper' && hasAnyPositions) {
      hasRefreshedRef.current = true;
      refreshPaperPrices();
    }
  }, [location.key, activeTab, hasAnyPositions, refreshPaperPrices]);

  // Also refresh when switching tabs
  useEffect(() => {
    if (activeTab === 'paper' && hasAnyPositions) {
      refreshPaperPrices();
    }
    // Only run when activeTab changes, not on every refreshPaperPrices change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Determine which portfolio to display
  const isShowingPaper = activeTab === 'paper';
  const displayPositions: Position[] = isShowingPaper ? paperPortfolio.positions : (isLiveNotConnected ? [] : positions);
  const displayCash = isShowingPaper ? paperPortfolio.cashBalance : (isLiveNotConnected ? null : cashBalance);

  const totalPositionValue = displayPositions.reduce((sum, p) => sum + p.totalValue, 0);
  const totalPortfolioValue = displayCash !== null ? totalPositionValue + displayCash : null;

  // Paper portfolio specific stats (including unrealized short P/L)
  const shortUnrealizedPnL = (paperPortfolio.shortPositions || []).reduce((sum, s) => {
    return sum + (s.entryPrice - s.currentPrice) * s.shares;
  }, 0);
  const paperTotalValue = paperPortfolio.positions.reduce((sum, p) => sum + p.totalValue, 0) + paperPortfolio.cashBalance + shortUnrealizedPnL;
  const paperPnL = paperTotalValue - paperPortfolio.startingBalance;
  const paperPnLPercent = (paperPnL / paperPortfolio.startingBalance) * 100;

  const pieData = isLiveNotConnected ? [] : [
    ...displayPositions.map((p) => ({
      name: p.symbol,
      value: p.totalValue,
    })),
    { name: 'Cash', value: displayCash ?? 0 },
  ].filter((d) => d.value > 0);

  const handleResetPaper = () => {
    resetPaperPortfolio(10000);
    setShowResetConfirm(false);
  };

  const handleExport = (format: 'csv' | 'json' | 'print') => {
    const exportData = {
      positions: displayPositions,
      trades: isShowingPaper ? paperPortfolio.trades : [],
      cashBalance: displayCash,
      totalValue: totalPortfolioValue,
      exportDate: new Date(),
      portfolioType: activeTab,
    };

    switch (format) {
      case 'csv':
        exportToCSV(exportData);
        break;
      case 'json':
        exportToJSON(exportData);
        break;
      case 'print':
        exportToPrintableHTML(exportData);
        break;
    }
    setShowExportMenu(false);
  };

  return (
    <div className="text-white">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Portfolio</h1>

        <div className="flex items-center gap-4">
          {/* Export Dropdown */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Export
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-slate-800 rounded-lg shadow-lg border border-slate-700 py-1 z-10">
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full text-left px-4 py-2 hover:bg-slate-700 text-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export to CSV
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className="w-full text-left px-4 py-2 hover:bg-slate-700 text-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                  Export to JSON
                </button>
                <button
                  onClick={() => handleExport('print')}
                  className="w-full text-left px-4 py-2 hover:bg-slate-700 text-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                  Print Report
                </button>
              </div>
            )}
          </div>

          {/* Portfolio Tabs */}
          <div className="flex bg-slate-800 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('paper')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'paper'
                ? 'bg-amber-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Paper Portfolio
          </button>
          <button
            onClick={() => setActiveTab('live')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'live'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Live Portfolio
          </button>
        </div>
        </div>
      </div>

      {/* Active Mode Indicator */}
      {tradingMode === activeTab && (
        <div className={`mb-4 px-3 py-1 rounded-full text-xs font-medium inline-block ${
          tradingMode === 'paper' ? 'bg-amber-900 text-amber-300' : 'bg-emerald-900 text-emerald-300'
        }`}>
          Currently Active
        </div>
      )}

      {/* Paper Portfolio Summary */}
      {isShowingPaper && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-800 rounded-xl p-4">
            <div className="text-sm text-slate-400">Starting Balance</div>
            <div className="text-xl font-semibold">${paperPortfolio.startingBalance.toLocaleString()}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-4">
            <div className="text-sm text-slate-400">Current Value</div>
            <div className="text-xl font-semibold">${paperTotalValue.toLocaleString()}</div>
          </div>
          <div className="bg-slate-800 rounded-xl p-4">
            <div className="text-sm text-slate-400">Total P&L</div>
            <div className={`text-xl font-semibold ${paperPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {paperPnL >= 0 ? '+' : ''}${paperPnL.toLocaleString()} ({paperPnLPercent.toFixed(2)}%)
            </div>
          </div>
          <div className="bg-slate-800 rounded-xl p-4">
            <div className="text-sm text-slate-400">Trades</div>
            <div className="text-xl font-semibold">{paperPortfolio.trades.length}</div>
            <button
              onClick={() => setShowResetConfirm(true)}
              className="text-xs text-red-400 hover:text-red-300 mt-1"
            >
              Reset Paper Portfolio
            </button>
          </div>
        </div>
      )}

      {/* Refresh Prices Button */}
      {isShowingPaper && hasAnyPositions && (
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={refreshPaperPrices}
            disabled={isRefreshing}
            className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {isRefreshing ? 'Refreshing prices...' : 'Refresh Prices'}
          </button>
          {isRefreshing && (
            <span className="text-sm text-slate-400">Fetching live prices...</span>
          )}
          {!isRefreshing && lastUpdated && (
            <span className="text-sm text-slate-500">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl p-6 max-w-md">
            <h3 className="text-lg font-semibold mb-2">Reset Paper Portfolio?</h3>
            <p className="text-slate-400 mb-4">
              This will clear all paper positions and trades, and reset your balance to $10,000.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleResetPaper}
                className="flex-1 bg-red-600 hover:bg-red-700 py-2 rounded-lg"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Short Positions Section */}
      {isShowingPaper && (paperPortfolio.shortPositions?.length || 0) > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <span className="text-red-400">Short Positions</span>
            <span className="text-xs bg-red-900 text-red-300 px-2 py-1 rounded">BEARISH</span>
          </h2>
          <p className="text-sm text-slate-400 mb-4">
            Short positions profit when prices go DOWN. You've borrowed shares and sold them, hoping to buy back cheaper.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-700">
                  <th className="pb-3">Symbol</th>
                  <th className="pb-3">Shares</th>
                  <th className="pb-3">Entry Price</th>
                  <th className="pb-3">Current</th>
                  <th className="pb-3">Lowest</th>
                  <th className="pb-3">Unrealized P/L</th>
                </tr>
              </thead>
              <tbody>
                {(paperPortfolio.shortPositions || []).map((short: ShortPosition) => {
                  const profitLoss = (short.entryPrice - short.currentPrice) * short.shares;
                  const profitLossPercent = ((short.entryPrice - short.currentPrice) / short.entryPrice) * 100;
                  return (
                    <tr key={short.id} className="border-b border-slate-700">
                      <td className="py-4">
                        <div className="font-semibold flex items-center gap-2">
                          {short.symbol}
                          <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">SHORT</span>
                        </div>
                      </td>
                      <td className="py-4">{short.shares}</td>
                      <td className="py-4">${short.entryPrice.toFixed(2)}</td>
                      <td className="py-4">${short.currentPrice.toFixed(2)}</td>
                      <td className="py-4 text-slate-400">${(short.lowestPrice || short.entryPrice).toFixed(2)}</td>
                      <td className="py-4">
                        <span className={profitLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {profitLoss >= 0 ? '+' : ''}${profitLoss.toFixed(2)} ({profitLossPercent >= 0 ? '+' : ''}{profitLossPercent.toFixed(2)}%)
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2 bg-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">
            {isShowingPaper ? 'Long Positions' : 'Live Holdings'}
          </h2>
          {displayPositions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-slate-400">
                {isShowingPaper
                  ? 'No paper positions yet. Make some paper trades to build your portfolio.'
                  : 'No live positions yet. Connect to IBKR and start trading.'}
              </p>
              {isShowingPaper && tradingMode !== 'paper' && (
                <p className="text-sm text-amber-400 mt-2">
                  Switch to Paper Trading mode in Settings to make paper trades.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="pb-3">Symbol</th>
                    <th className="pb-3">Shares</th>
                    <th className="pb-3">Avg Cost</th>
                    <th className="pb-3">Current</th>
                    <th className="pb-3">Value</th>
                    <th className="pb-3">Gain/Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {displayPositions.map((position) => (
                    <tr key={position.id} className="border-b border-slate-700">
                      <td className="py-4">
                        <div className="font-semibold">{position.symbol}</div>
                        <div className="text-sm text-slate-400">{position.name}</div>
                      </td>
                      <td className="py-4">{position.shares}</td>
                      <td className="py-4">${position.avgCost.toFixed(2)}</td>
                      <td className="py-4">${position.currentPrice.toFixed(2)}</td>
                      <td className="py-4">${position.totalValue.toLocaleString()}</td>
                      <td className="py-4">
                        <span
                          className={
                            position.totalGain >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }
                        >
                          ${position.totalGain.toLocaleString()} (
                          {position.totalGainPercent.toFixed(2)}%)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Allocation</h2>
          {isLiveNotConnected ? (
            <div className="h-64 flex items-center justify-center text-slate-400">
              IBKR not connected
            </div>
          ) : pieData.length === 0 || totalPortfolioValue === 0 || totalPortfolioValue === null ? (
            <div className="h-64 flex items-center justify-center text-slate-400">
              No allocation data
            </div>
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: 'none',
                        borderRadius: '8px',
                      }}
                      formatter={(value) => `$${Number(value).toLocaleString()}`}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 space-y-2">
                {pieData.map((item, index) => (
                  <div key={item.name} className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span>{item.name}</span>
                    </div>
                    <span className="text-slate-400">
                      {((item.value / totalPortfolioValue) * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Paper Trade History */}
      {isShowingPaper && paperPortfolio.trades.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Paper Trade History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-700">
                  <th className="pb-3">Date</th>
                  <th className="pb-3">Symbol</th>
                  <th className="pb-3">Type</th>
                  <th className="pb-3">Shares</th>
                  <th className="pb-3">Price</th>
                  <th className="pb-3">Total</th>
                  <th className="pb-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {paperPortfolio.trades.slice(0, 20).map((trade) => (
                  <tr key={trade.id} className="border-b border-slate-700/50">
                    <td className="py-3">
                      <div>{new Date(trade.date).toLocaleDateString()}</div>
                      <div className="text-xs text-slate-500">{new Date(trade.date).toLocaleTimeString()}</div>
                    </td>
                    <td className="py-3 font-medium">{trade.symbol}</td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded text-xs ${
                        trade.type === 'buy'
                          ? 'bg-emerald-900 text-emerald-300'
                          : trade.type === 'sell'
                          ? 'bg-red-900 text-red-300'
                          : trade.type === 'short'
                          ? 'bg-purple-900 text-purple-300'
                          : 'bg-amber-900 text-amber-300'
                      }`}>
                        {trade.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3">{trade.shares}</td>
                    <td className="py-3">${trade.price.toFixed(2)}</td>
                    <td className="py-3">${trade.total.toLocaleString()}</td>
                    <td className="py-3 text-slate-400">{trade.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paperPortfolio.trades.length > 20 && (
              <p className="text-center text-slate-500 mt-4">
                Showing 20 of {paperPortfolio.trades.length} trades
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
