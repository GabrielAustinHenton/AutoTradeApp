import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useQuote, useSymbolSearch, useDailyData } from '../hooks/useStockData';
import { ibkr } from '../services/ibkr';
import type { Trade, Position } from '../types';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export function Trade() {
  const {
    addTrade,
    addPosition,
    positions,
    updatePosition,
    cashBalance,
    setCashBalance,
    ibkrConnected,
    syncFromIBKR,
    tradingMode,
    paperPortfolio,
    addPaperTrade,
    updatePaperPosition,
  } = useStore();

  // Use paper portfolio when in paper mode
  const isLiveMode = tradingMode === 'live' && ibkrConnected;
  const activeCashBalance = isLiveMode ? cashBalance : paperPortfolio.cashBalance;
  const activePositions = isLiveMode ? positions : paperPortfolio.positions;
  const [symbol, setSymbol] = useState('');
  const [shares, setShares] = useState('');
  const [price, setPrice] = useState('');
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [notes, setNotes] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderStatus, setOrderStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { quote, loading: quoteLoading } = useQuote(symbol || null);
  const { results: searchResults, loading: searchLoading, search } = useSymbolSearch();
  const { data: chartData } = useDailyData(symbol || null);

  // Clear price when switching to market order
  useEffect(() => {
    if (orderType === 'market') {
      setPrice('');
    }
  }, [orderType]);

  const handleSymbolChange = (value: string) => {
    setSymbol(value.toUpperCase());
    if (value.length >= 1) {
      search(value);
      setShowSearch(true);
    } else {
      setShowSearch(false);
    }
  };

  const selectSymbol = (sym: string) => {
    setSymbol(sym);
    setShowSearch(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderStatus(null);
    setSubmitting(true);

    const sharesNum = parseInt(shares);
    // For market orders, use the current quote price; for limit orders, use the entered price
    const priceNum = orderType === 'market' ? (quote?.price || 0) : parseFloat(price);

    if (orderType === 'market' && !quote) {
      setOrderStatus({ type: 'error', message: 'Unable to get current market price. Please try again.' });
      setSubmitting(false);
      return;
    }

    const total = sharesNum * priceNum;

    try {
      // Live mode - execute real trade via IBKR
      if (isLiveMode) {
        const conid = await ibkr.getConidForSymbol(symbol.toUpperCase());
        if (!conid) {
          throw new Error(`Could not find contract for symbol: ${symbol}`);
        }

        if (orderType === 'market') {
          if (tradeType === 'buy') {
            await ibkr.buyMarket(conid, sharesNum);
          } else {
            await ibkr.sellMarket(conid, sharesNum);
          }
        } else {
          if (tradeType === 'buy') {
            await ibkr.buyLimit(conid, sharesNum, priceNum);
          } else {
            await ibkr.sellLimit(conid, sharesNum, priceNum);
          }
        }

        setOrderStatus({
          type: 'success',
          message: `${tradeType === 'buy' ? 'Buy' : 'Sell'} order for ${sharesNum} shares of ${symbol.toUpperCase()} submitted to IBKR!`,
        });

        setTimeout(() => syncFromIBKR(), 2000);
      } else {
        // Paper trading mode
        if (tradeType === 'buy' && total > activeCashBalance) {
          setOrderStatus({ type: 'error', message: 'Insufficient funds' });
          setSubmitting(false);
          return;
        }

        const existingPosition = activePositions.find(
          (p) => p.symbol === symbol.toUpperCase()
        );

        if (tradeType === 'sell') {
          if (!existingPosition || existingPosition.shares < sharesNum) {
            setOrderStatus({ type: 'error', message: 'Insufficient shares' });
            setSubmitting(false);
            return;
          }
        }

        const trade: Trade = {
          id: crypto.randomUUID(),
          symbol: symbol.toUpperCase(),
          type: tradeType,
          shares: sharesNum,
          price: priceNum,
          total,
          date: new Date(),
          notes: notes || undefined,
        };

        // Add trade to paper portfolio
        addPaperTrade(trade);

        // Update paper positions
        if (tradeType === 'buy') {
          // Update paper cash balance
          useStore.setState((state) => ({
            paperPortfolio: {
              ...state.paperPortfolio,
              cashBalance: state.paperPortfolio.cashBalance - total,
            },
          }));

          if (existingPosition) {
            const newShares = existingPosition.shares + sharesNum;
            const newTotalCost = existingPosition.avgCost * existingPosition.shares + total;
            const newAvgCost = newTotalCost / newShares;
            updatePaperPosition(symbol.toUpperCase(), newShares, newAvgCost, priceNum);
          } else {
            updatePaperPosition(symbol.toUpperCase(), sharesNum, priceNum, priceNum);
          }
        } else {
          // Sell - update paper cash balance
          useStore.setState((state) => ({
            paperPortfolio: {
              ...state.paperPortfolio,
              cashBalance: state.paperPortfolio.cashBalance + total,
            },
          }));

          const newShares = existingPosition!.shares - sharesNum;
          updatePaperPosition(
            symbol.toUpperCase(),
            newShares,
            existingPosition!.avgCost,
            priceNum
          );
        }

        setOrderStatus({
          type: 'success',
          message: `Paper trade: ${tradeType === 'buy' ? 'Bought' : 'Sold'} ${sharesNum} shares of ${symbol.toUpperCase()}`,
        });
      }

      // Reset form
      setSymbol('');
      setShares('');
      setPrice('');
      setNotes('');
    } catch (error) {
      setOrderStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Order failed',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const formattedChartData = chartData.slice(-30).map((d) => ({
    date: d.timestamp.split(' ')[0],
    price: d.close,
  }));

  return (
    <div className="text-white">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Trade</h1>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
          isLiveMode
            ? 'bg-red-900/50 text-red-400 border border-red-700'
            : 'bg-emerald-900/50 text-emerald-400'
        }`}>
          <span className={`w-2 h-2 rounded-full ${isLiveMode ? 'bg-red-500' : 'bg-emerald-500'}`} />
          {isLiveMode ? 'Live Trading' : 'Paper Trading'}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">Place Order</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setTradeType('buy')}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                    tradeType === 'buy'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  Buy
                </button>
                <button
                  type="button"
                  onClick={() => setTradeType('sell')}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                    tradeType === 'sell'
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  Sell
                </button>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-2">Order Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOrderType('market')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      orderType === 'market'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    Market
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderType('limit')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      orderType === 'limit'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    Limit
                  </button>
                </div>
                {orderType === 'market' && (
                  <p className="text-xs text-slate-500 mt-1">Executes at current market price</p>
                )}
                {orderType === 'limit' && (
                  <p className="text-xs text-slate-500 mt-1">Executes when price reaches your specified limit</p>
                )}
              </div>

              <div className="relative">
                <label className="block text-sm text-slate-400 mb-2">Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => handleSymbolChange(e.target.value)}
                  onFocus={() => symbol && setShowSearch(true)}
                  placeholder="Search for a stock..."
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500"
                  required
                />
                {showSearch && searchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-slate-700 border border-slate-600 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {searchLoading ? (
                      <div className="p-3 text-slate-400">Searching...</div>
                    ) : (
                      searchResults.slice(0, 5).map((result) => (
                        <button
                          key={result.symbol}
                          type="button"
                          onClick={() => selectSymbol(result.symbol)}
                          className="w-full text-left px-4 py-3 hover:bg-slate-600 border-b border-slate-600 last:border-0"
                        >
                          <div className="font-semibold">{result.symbol}</div>
                          <div className="text-sm text-slate-400 truncate">{result.name}</div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {quote && (
                <div className="bg-slate-700 rounded-lg p-4">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Current Price</span>
                    <div className="text-right">
                      <span className="text-xl font-bold">${quote.price.toFixed(2)}</span>
                      <span className={`ml-2 ${quote.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {quote.change >= 0 ? '+' : ''}{quote.change.toFixed(2)} ({quote.changePercent.toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-4 mt-2 text-sm text-slate-400">
                    <span>H: ${quote.high.toFixed(2)}</span>
                    <span>L: ${quote.low.toFixed(2)}</span>
                    <span>Vol: {(quote.volume / 1000000).toFixed(2)}M</span>
                  </div>
                </div>
              )}

              {quoteLoading && symbol && (
                <div className="bg-slate-700 rounded-lg p-4 animate-pulse">
                  <div className="h-6 bg-slate-600 rounded w-32"></div>
                </div>
              )}

              <div>
                <label className="block text-sm text-slate-400 mb-2">Shares</label>
                <input
                  type="number"
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  placeholder="100"
                  min="1"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              {orderType === 'limit' && (
                <div>
                  <label className="block text-sm text-slate-400 mb-2">Limit Price</label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="150.00"
                    step="0.01"
                    min="0.01"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              )}

              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Why are you making this trade?"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500"
                  rows={3}
                />
              </div>

              {shares && (orderType === 'limit' ? price : quote) && (
                <div className="bg-slate-700 rounded-lg p-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-slate-400">
                      {orderType === 'market' ? 'Estimated Total' : 'Total'}
                    </span>
                    <span className="font-semibold text-xl">
                      ${(parseInt(shares) * (orderType === 'market' ? (quote?.price || 0) : parseFloat(price))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {orderType === 'market' && quote && (
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-400">Market price</span>
                      <span>${quote.price.toFixed(2)}</span>
                    </div>
                  )}
                  {tradeType === 'buy' && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Cash after trade</span>
                      <span className={activeCashBalance - parseInt(shares) * (orderType === 'market' ? (quote?.price || 0) : parseFloat(price)) < 0 ? 'text-red-400' : ''}>
                        ${(activeCashBalance - parseInt(shares) * (orderType === 'market' ? (quote?.price || 0) : parseFloat(price))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {orderStatus && (
                <div className={`p-3 rounded-lg ${
                  orderStatus.type === 'success'
                    ? 'bg-emerald-900/30 border border-emerald-700 text-emerald-300'
                    : 'bg-red-900/30 border border-red-700 text-red-300'
                }`}>
                  {orderStatus.message}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className={`w-full py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  tradeType === 'buy'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {submitting ? 'Submitting...' : `${tradeType === 'buy' ? 'Buy' : 'Sell'} ${symbol.toUpperCase() || 'Stock'}`}
              </button>
            </form>
          </div>
        </div>

        <div className="space-y-6">
          {symbol && formattedChartData.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-6">
              <h2 className="text-xl font-semibold mb-4">{symbol} - 30 Day Chart</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={formattedChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis
                      dataKey="date"
                      stroke="#9ca3af"
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      stroke="#9ca3af"
                      domain={['auto', 'auto']}
                      tick={{ fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: 'none',
                        borderRadius: '8px',
                      }}
                      formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Price']}
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="bg-slate-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-4">
              {isLiveMode ? 'Live Account' : 'Paper Account'}
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between p-4 bg-slate-700 rounded-lg">
                <span className="text-slate-400">Cash Available</span>
                <span className="font-semibold text-emerald-400">
                  ${activeCashBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between p-4 bg-slate-700 rounded-lg">
                <span className="text-slate-400">Positions</span>
                <span className="font-semibold">{activePositions.filter(p => p.shares > 0).length}</span>
              </div>
            </div>

            <h3 className="text-lg font-semibold mt-6 mb-4">Quick Trade</h3>
            <div className="space-y-2">
              {activePositions.filter(p => p.shares > 0).length === 0 ? (
                <p className="text-slate-400 text-sm">No positions to quick trade</p>
              ) : (
                activePositions.filter(p => p.shares > 0).map((position) => (
                  <div
                    key={position.id}
                    className="flex justify-between items-center p-3 bg-slate-700 rounded-lg"
                  >
                    <div>
                      <span className="font-semibold">{position.symbol}</span>
                      <span className="text-sm text-slate-400 ml-2">
                        {position.shares} shares
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setSymbol(position.symbol);
                        setShares(position.shares.toString());
                        setOrderType('market');
                        setTradeType('sell');
                      }}
                      className="text-sm text-red-400 hover:text-red-300"
                    >
                      Sell All
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
