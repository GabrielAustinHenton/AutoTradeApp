import { useMultipleQuotes } from '../../hooks/useStockData';
import { useStore } from '../../store/useStore';
import { useState } from 'react';

export function WatchlistCard() {
  const { watchlist, addToWatchlist, removeFromWatchlist } = useStore();
  const { quotes, loading, refetch } = useMultipleQuotes(watchlist, true);
  const [newSymbol, setNewSymbol] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleAddSymbol = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSymbol.trim()) {
      addToWatchlist(newSymbol.trim().toUpperCase());
      setNewSymbol('');
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex justify-between items-center px-4 md:px-6 py-4 hover:bg-slate-750 transition-colors group"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg md:text-xl font-semibold">Watchlist</h2>
          <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded-full">
            {watchlist.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {loading && <span className="text-xs text-slate-400">Updating...</span>}
          <svg
            className={`w-5 h-5 text-slate-400 group-hover:text-slate-200 transition-all duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 md:px-6 pb-4 md:pb-6 border-t border-slate-700 pt-4">
          <div className="flex justify-end mb-3">
            <button
              onClick={refetch}
              disabled={loading}
              className="text-sm text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
            >
              {loading ? 'Updating...' : 'Refresh'}
            </button>
          </div>

          <form onSubmit={handleAddSymbol} className="mb-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value)}
                placeholder="Add symbol..."
                className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded-lg text-sm"
              >
                Add
              </button>
            </div>
          </form>

          <div className="space-y-2">
            {watchlist.map((symbol) => {
              const quote = quotes.get(symbol);
              const isPositive = quote ? quote.change >= 0 : true;

              return (
                <div
                  key={symbol}
                  className="flex justify-between items-center p-3 bg-slate-700 rounded-lg group"
                >
                  <div>
                    <span className="font-semibold">{symbol}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {quote ? (
                      <div className="text-right">
                        <div className="font-semibold">${quote.price?.toFixed(2) ?? '--'}</div>
                        <div
                          className={`text-sm ${
                            isPositive ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {isPositive ? '+' : ''}
                          {quote.changePercent?.toFixed(2) ?? '0.00'}%
                        </div>
                      </div>
                    ) : loading ? (
                      <div className="animate-pulse h-8 w-16 bg-slate-600 rounded"></div>
                    ) : (
                      <span className="text-slate-500">--</span>
                    )}
                    <button
                      onClick={() => removeFromWatchlist(symbol)}
                      className="text-slate-500 hover:text-red-400 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
