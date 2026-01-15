import { useMultipleQuotes } from '../../hooks/useStockData';
import { useStore } from '../../store/useStore';
import { useState } from 'react';

export function WatchlistCard() {
  const { watchlist, addToWatchlist, removeFromWatchlist } = useStore();
  const { quotes, loading, refetch } = useMultipleQuotes(watchlist, true);
  const [newSymbol, setNewSymbol] = useState('');

  const handleAddSymbol = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSymbol.trim()) {
      addToWatchlist(newSymbol.trim().toUpperCase());
      setNewSymbol('');
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Watchlist</h2>
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
                    <div className="font-semibold">${quote.price.toFixed(2)}</div>
                    <div
                      className={`text-sm ${
                        isPositive ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {quote.changePercent.toFixed(2)}%
                    </div>
                  </div>
                ) : loading ? (
                  <div className="animate-pulse h-8 w-16 bg-slate-600 rounded"></div>
                ) : (
                  <span className="text-slate-500">--</span>
                )}
                <button
                  onClick={() => removeFromWatchlist(symbol)}
                  className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
