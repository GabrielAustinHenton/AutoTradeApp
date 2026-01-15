import { useState, useMemo } from 'react';
import { useStore } from '../store/useStore';

export function TradeHistory() {
  const { trades, removeTrade } = useStore();
  const [filterSymbol, setFilterSymbol] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'buy' | 'sell'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'symbol' | 'total'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Get unique symbols for filter dropdown
  const uniqueSymbols = useMemo(() => {
    return [...new Set(trades.map((t) => t.symbol))].sort();
  }, [trades]);

  // Filter and sort trades
  const filteredTrades = useMemo(() => {
    let result = [...trades];

    // Filter by symbol
    if (filterSymbol) {
      result = result.filter((t) => t.symbol === filterSymbol);
    }

    // Filter by type
    if (filterType !== 'all') {
      result = result.filter((t) => t.type === filterType);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'symbol':
          comparison = a.symbol.localeCompare(b.symbol);
          break;
        case 'total':
          comparison = a.total - b.total;
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [trades, filterSymbol, filterType, sortBy, sortOrder]);

  // Calculate summary stats
  const stats = useMemo(() => {
    const buys = filteredTrades.filter((t) => t.type === 'buy');
    const sells = filteredTrades.filter((t) => t.type === 'sell');

    return {
      totalTrades: filteredTrades.length,
      buyCount: buys.length,
      sellCount: sells.length,
      totalBuyValue: buys.reduce((sum, t) => sum + t.total, 0),
      totalSellValue: sells.reduce((sum, t) => sum + t.total, 0),
      netFlow: sells.reduce((sum, t) => sum + t.total, 0) - buys.reduce((sum, t) => sum + t.total, 0),
    };
  }, [filteredTrades]);

  const handleSort = (column: 'date' | 'symbol' | 'total') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const exportToCSV = () => {
    const headers = ['Date', 'Symbol', 'Type', 'Shares', 'Price', 'Total', 'Notes'];
    const rows = filteredTrades.map((trade) => [
      new Date(trade.date).toISOString(),
      trade.symbol,
      trade.type,
      trade.shares.toString(),
      trade.price.toFixed(2),
      trade.total.toFixed(2),
      trade.notes ? `"${trade.notes.replace(/"/g, '""')}"` : '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `trade-history-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="text-white">
      <h1 className="text-3xl font-bold mb-8">Trade History</h1>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="text-slate-400 text-sm">Total Trades</div>
          <div className="text-2xl font-bold">{stats.totalTrades}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="text-slate-400 text-sm">Buy Orders</div>
          <div className="text-2xl font-bold text-emerald-400">{stats.buyCount}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="text-slate-400 text-sm">Sell Orders</div>
          <div className="text-2xl font-bold text-red-400">{stats.sellCount}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="text-slate-400 text-sm">Total Bought</div>
          <div className="text-xl font-bold text-emerald-400">
            ${stats.totalBuyValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="text-slate-400 text-sm">Total Sold</div>
          <div className="text-xl font-bold text-red-400">
            ${stats.totalSellValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <div className="text-slate-400 text-sm">Net Cash Flow</div>
          <div className={`text-xl font-bold ${stats.netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {stats.netFlow >= 0 ? '+' : ''}${stats.netFlow.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-800 rounded-xl p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Symbol</label>
            <select
              value={filterSymbol}
              onChange={(e) => setFilterSymbol(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
            >
              <option value="">All Symbols</option>
              {uniqueSymbols.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Type</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'buy' | 'sell')}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Types</option>
              <option value="buy">Buy Only</option>
              <option value="sell">Sell Only</option>
            </select>
          </div>

          {(filterSymbol || filterType !== 'all') && (
            <button
              onClick={() => {
                setFilterSymbol('');
                setFilterType('all');
              }}
              className="mt-5 text-sm text-slate-400 hover:text-white"
            >
              Clear Filters
            </button>
          )}

          <div className="flex-1" />

          <button
            onClick={exportToCSV}
            disabled={filteredTrades.length === 0}
            className="mt-5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Trade Table */}
      <div className="bg-slate-800 rounded-xl overflow-hidden">
        {filteredTrades.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            {trades.length === 0
              ? 'No trades yet. Start trading to see your history here.'
              : 'No trades match the current filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700">
                  <th
                    className="text-left p-4 text-slate-400 font-medium cursor-pointer hover:text-white"
                    onClick={() => handleSort('date')}
                  >
                    Date {sortBy === 'date' && (sortOrder === 'desc' ? '▼' : '▲')}
                  </th>
                  <th
                    className="text-left p-4 text-slate-400 font-medium cursor-pointer hover:text-white"
                    onClick={() => handleSort('symbol')}
                  >
                    Symbol {sortBy === 'symbol' && (sortOrder === 'desc' ? '▼' : '▲')}
                  </th>
                  <th className="text-left p-4 text-slate-400 font-medium">Type</th>
                  <th className="text-right p-4 text-slate-400 font-medium">Shares</th>
                  <th className="text-right p-4 text-slate-400 font-medium">Price</th>
                  <th
                    className="text-right p-4 text-slate-400 font-medium cursor-pointer hover:text-white"
                    onClick={() => handleSort('total')}
                  >
                    Total {sortBy === 'total' && (sortOrder === 'desc' ? '▼' : '▲')}
                  </th>
                  <th className="text-left p-4 text-slate-400 font-medium">Notes</th>
                  <th className="p-4"></th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((trade) => (
                  <tr
                    key={trade.id}
                    className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                  >
                    <td className="p-4 text-sm text-slate-300">
                      {formatDate(trade.date)}
                    </td>
                    <td className="p-4 font-semibold">{trade.symbol}</td>
                    <td className="p-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          trade.type === 'buy'
                            ? 'bg-emerald-900/50 text-emerald-300'
                            : 'bg-red-900/50 text-red-300'
                        }`}
                      >
                        {trade.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-4 text-right">{trade.shares}</td>
                    <td className="p-4 text-right">${trade.price.toFixed(2)}</td>
                    <td className="p-4 text-right font-semibold">
                      ${trade.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 text-sm text-slate-400 max-w-xs truncate">
                      {trade.notes || '-'}
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => {
                          if (confirm('Delete this trade from history?')) {
                            removeTrade(trade.id);
                          }
                        }}
                        className="text-slate-500 hover:text-red-400 transition-colors"
                        title="Delete trade"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
