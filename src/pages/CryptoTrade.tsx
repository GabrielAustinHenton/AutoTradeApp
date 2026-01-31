import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getBinancePrice, getBinanceCandles } from '../services/binanceApi';
import { useDCABot } from '../hooks/useDCABot';
import { useGridBot } from '../hooks/useGridBot';
import type { PriceHistory, CryptoPosition, DCAConfig, GridConfig, CryptoTrade as CryptoTradeType } from '../types';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const CRYPTO_SYMBOLS = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'DOT', name: 'Polkadot' },
  { symbol: 'AVAX', name: 'Avalanche' },
  { symbol: 'LINK', name: 'Chainlink' },
  { symbol: 'POL', name: 'Polygon' },
  { symbol: 'PEPE', name: 'Pepe' },
  { symbol: 'SHIB', name: 'Shiba Inu' },
  { symbol: 'LTC', name: 'Litecoin' },
  { symbol: 'UNI', name: 'Uniswap' },
  { symbol: 'ATOM', name: 'Cosmos' },
  { symbol: 'FIL', name: 'Filecoin' },
  { symbol: 'APT', name: 'Aptos' },
  { symbol: 'ARB', name: 'Arbitrum' },
  { symbol: 'OP', name: 'Optimism' },
  { symbol: 'SUI', name: 'Sui' },
];

interface CryptoQuote {
  price: number;
  change24h: number;
  changePercent24h: number;
}

export function CryptoTrade() {
  const {
    cryptoPortfolio,
    addCryptoTrade,
    addCryptoPosition,
    updateCryptoPosition,
    removeCryptoPosition,
    setCryptoUsdBalance,
    dcaConfigs,
    addDCAConfig,
    updateDCAConfig,
    removeDCAConfig,
    gridConfigs,
    addGridConfig,
    updateGridConfig,
    removeGridConfig,
  } = useStore();

  const [selectedSymbol, setSelectedSymbol] = useState('BTC');
  const [quote, setQuote] = useState<CryptoQuote | null>(null);
  const [chartData, setChartData] = useState<PriceHistory[]>([]);
  const [chartInterval, setChartInterval] = useState<'15min' | '1h' | '4h' | '1d'>('1h');
  const [loading, setLoading] = useState(false);

  // Trade form state
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [orderStatus, setOrderStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // DCA form state
  const [showDCAForm, setShowDCAForm] = useState(false);
  const [dcaSymbol, setDCASymbol] = useState('BTC');
  const [dcaAmount, setDCAAmount] = useState('100');
  const [dcaInterval, setDCAInterval] = useState<'hourly' | 'daily' | 'weekly'>('daily');

  // Grid form state
  const [showGridForm, setShowGridForm] = useState(false);
  const [gridSymbol, setGridSymbol] = useState('BTC');
  const [gridLower, setGridLower] = useState('');
  const [gridUpper, setGridUpper] = useState('');
  const [gridLevels, setGridLevels] = useState('10');
  const [gridAmount, setGridAmount] = useState('100');

  // Initialize bots
  const { enabledCount: dcaEnabledCount, executeDCA } = useDCABot();
  const { enabledCount: gridEnabledCount } = useGridBot();

  // Fetch price
  const fetchPrice = useCallback(async () => {
    const price = await getBinancePrice(selectedSymbol);
    if (price) {
      setQuote({ price, change24h: 0, changePercent24h: 0 });

      // Update position prices
      const position = cryptoPortfolio.positions.find((p: CryptoPosition) => p.symbol === selectedSymbol);
      if (position) {
        updateCryptoPosition(position.id, { currentPrice: price });
      }
    }
  }, [selectedSymbol, cryptoPortfolio.positions, updateCryptoPosition]);

  // Fetch chart data
  const fetchChartData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBinanceCandles(selectedSymbol, chartInterval, 100);
      setChartData(data);
    } catch (error) {
      console.error('Error fetching chart data:', error);
    }
    setLoading(false);
  }, [selectedSymbol, chartInterval]);

  // Initial fetch and interval
  useEffect(() => {
    fetchPrice();
    fetchChartData();

    const priceInterval = setInterval(fetchPrice, 10000);
    return () => clearInterval(priceInterval);
  }, [fetchPrice, fetchChartData]);

  // Format chart data for Recharts
  const formattedChartData = chartData.map((d) => ({
    date: d.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    price: d.close,
    fullDate: d.date.toLocaleString(),
  }));

  // Handle trade submission
  const handleTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrderStatus(null);
    setSubmitting(true);

    const usdAmount = parseFloat(amount);
    if (!quote || isNaN(usdAmount) || usdAmount <= 0) {
      setOrderStatus({ type: 'error', message: 'Invalid amount' });
      setSubmitting(false);
      return;
    }

    const cryptoAmount = usdAmount / quote.price;

    try {
      if (tradeType === 'buy') {
        if (usdAmount > cryptoPortfolio.usdBalance) {
          throw new Error('Insufficient USD balance');
        }

        addCryptoTrade({
          id: crypto.randomUUID(),
          symbol: selectedSymbol,
          type: 'buy',
          amount: cryptoAmount,
          price: quote.price,
          total: usdAmount,
          date: new Date(),
        });

        setCryptoUsdBalance(cryptoPortfolio.usdBalance - usdAmount);

        const existingPosition = cryptoPortfolio.positions.find((p: CryptoPosition) => p.symbol === selectedSymbol);
        if (existingPosition) {
          const newAmount = existingPosition.amount + cryptoAmount;
          const newAvgCost = ((existingPosition.avgCost * existingPosition.amount) + usdAmount) / newAmount;
          updateCryptoPosition(existingPosition.id, {
            amount: newAmount,
            avgCost: newAvgCost,
            currentPrice: quote.price,
          });
        } else {
          addCryptoPosition({
            id: crypto.randomUUID(),
            symbol: selectedSymbol,
            amount: cryptoAmount,
            avgCost: quote.price,
            currentPrice: quote.price,
          });
        }

        setOrderStatus({ type: 'success', message: `Bought ${cryptoAmount.toFixed(6)} ${selectedSymbol}` });
      } else {
        const position = cryptoPortfolio.positions.find((p: CryptoPosition) => p.symbol === selectedSymbol);
        if (!position) {
          throw new Error(`No ${selectedSymbol} position to sell`);
        }

        const sellAmount = usdAmount / quote.price;
        if (sellAmount > position.amount) {
          throw new Error(`Insufficient ${selectedSymbol} balance`);
        }

        addCryptoTrade({
          id: crypto.randomUUID(),
          symbol: selectedSymbol,
          type: 'sell',
          amount: sellAmount,
          price: quote.price,
          total: usdAmount,
          date: new Date(),
        });

        setCryptoUsdBalance(cryptoPortfolio.usdBalance + usdAmount);

        const newAmount = position.amount - sellAmount;
        if (newAmount < 0.00000001) {
          removeCryptoPosition(position.id);
        } else {
          updateCryptoPosition(position.id, { amount: newAmount, currentPrice: quote.price });
        }

        setOrderStatus({ type: 'success', message: `Sold ${sellAmount.toFixed(6)} ${selectedSymbol}` });
      }

      setAmount('');
    } catch (error) {
      setOrderStatus({ type: 'error', message: error instanceof Error ? error.message : 'Trade failed' });
    }

    setSubmitting(false);
  };

  // Handle DCA save
  const handleSaveDCA = () => {
    const amountNum = parseFloat(dcaAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    addDCAConfig({
      id: crypto.randomUUID(),
      symbol: dcaSymbol,
      amount: amountNum,
      interval: dcaInterval,
      enabled: true,
      nextExecution: new Date(),
    });
    setShowDCAForm(false);
  };

  // Handle Grid save
  const handleSaveGrid = () => {
    const lower = parseFloat(gridLower);
    const upper = parseFloat(gridUpper);
    const levels = parseInt(gridLevels);
    const amountNum = parseFloat(gridAmount);

    if (isNaN(lower) || isNaN(upper) || isNaN(levels) || isNaN(amountNum)) return;
    if (lower >= upper || levels < 2) return;

    addGridConfig({
      id: crypto.randomUUID(),
      symbol: gridSymbol,
      lowerPrice: lower,
      upperPrice: upper,
      gridLevels: levels,
      amountPerGrid: amountNum,
      enabled: true,
      activeOrders: [],
    });
    setShowGridForm(false);
  };

  // Calculate portfolio metrics
  const positionsValue = cryptoPortfolio.positions.reduce(
    (sum: number, p: CryptoPosition) => sum + p.amount * p.currentPrice,
    0
  );
  const totalPortfolioValue = cryptoPortfolio.usdBalance + positionsValue;
  const startingBalance = cryptoPortfolio.startingBalance || 10000;
  const totalPnL = totalPortfolioValue - startingBalance;
  const totalPnLPercent = (totalPnL / startingBalance) * 100;

  return (
    <div className="text-white">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Crypto Trade</h1>
          {dcaEnabledCount > 0 && (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-emerald-900 text-emerald-300 animate-pulse">
              {dcaEnabledCount} DCA bot{dcaEnabledCount > 1 ? 's' : ''} running
            </span>
          )}
          {gridEnabledCount > 0 && (
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-900 text-blue-300 animate-pulse">
              {gridEnabledCount} Grid bot{gridEnabledCount > 1 ? 's' : ''} running
            </span>
          )}
        </div>
      </div>

      {/* Portfolio Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800 rounded-xl p-4">
          <h3 className="text-slate-400 text-sm">Portfolio Value</h3>
          <p className="text-xl font-bold">${totalPortfolioValue.toFixed(2)}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <h3 className="text-slate-400 text-sm">USD Balance</h3>
          <p className="text-xl font-bold">${cryptoPortfolio.usdBalance.toFixed(2)}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <h3 className="text-slate-400 text-sm">Total P/L</h3>
          <p className={`text-xl font-bold ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)} ({totalPnLPercent >= 0 ? '+' : ''}{totalPnLPercent.toFixed(1)}%)
          </p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4">
          <h3 className="text-slate-400 text-sm">Active Bots</h3>
          <p className="text-xl font-bold text-emerald-400">
            {dcaEnabledCount + gridEnabledCount}
          </p>
        </div>
      </div>

      {/* Symbol Selector & Price */}
      <div className="bg-slate-800 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-lg font-semibold focus:outline-none focus:border-emerald-500"
            >
              {CRYPTO_SYMBOLS.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.symbol} - {c.name}
                </option>
              ))}
            </select>

            {quote && (
              <div className="text-2xl font-bold">
                ${quote.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {(['15min', '1h', '4h', '1d'] as const).map((interval) => (
              <button
                key={interval}
                onClick={() => setChartInterval(interval)}
                className={`px-3 py-1 rounded ${
                  chartInterval === interval
                    ? 'bg-emerald-600'
                    : 'bg-slate-700 hover:bg-slate-600'
                }`}
              >
                {interval}
              </button>
            ))}
          </div>
        </div>

        {/* Price Chart */}
        <div className="h-64 mt-4">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-400">
              Loading chart...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={formattedChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#9ca3af" tick={{ fontSize: 12 }} />
                <YAxis stroke="#9ca3af" tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Price']}
                />
                <Line type="monotone" dataKey="price" stroke="#10b981" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Trade Form & Positions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Buy/Sell Form */}
        <div className="bg-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Trade {selectedSymbol}</h2>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setTradeType('buy')}
              className={`flex-1 py-2 rounded-lg font-medium ${
                tradeType === 'buy' ? 'bg-emerald-600' : 'bg-slate-700'
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setTradeType('sell')}
              className={`flex-1 py-2 rounded-lg font-medium ${
                tradeType === 'sell' ? 'bg-red-600' : 'bg-slate-700'
              }`}
            >
              Sell
            </button>
          </div>

          <form onSubmit={handleTrade} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Amount (USD)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-emerald-500"
              />
            </div>

            {quote && amount && !isNaN(parseFloat(amount)) && (
              <div className="text-sm text-slate-400">
                ≈ {(parseFloat(amount) / quote.price).toFixed(6)} {selectedSymbol}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !amount}
              className={`w-full py-3 rounded-lg font-semibold transition-colors ${
                tradeType === 'buy'
                  ? 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-800'
                  : 'bg-red-600 hover:bg-red-700 disabled:bg-red-800'
              } disabled:cursor-not-allowed`}
            >
              {submitting ? 'Processing...' : `${tradeType === 'buy' ? 'Buy' : 'Sell'} ${selectedSymbol}`}
            </button>
          </form>

          {orderStatus && (
            <div className={`mt-4 p-3 rounded-lg ${
              orderStatus.type === 'success' ? 'bg-emerald-900/50 text-emerald-300' : 'bg-red-900/50 text-red-300'
            }`}>
              {orderStatus.message}
            </div>
          )}
        </div>

        {/* Positions */}
        <div className="bg-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Your Positions</h2>

          {cryptoPortfolio.positions.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              No crypto positions yet. Buy some crypto to get started!
            </div>
          ) : (
            <div className="space-y-3">
              {cryptoPortfolio.positions.map((position: CryptoPosition) => {
                const value = position.amount * position.currentPrice;
                const cost = position.amount * position.avgCost;
                const gain = value - cost;
                const gainPercent = cost > 0 ? (gain / cost) * 100 : 0;

                return (
                  <div
                    key={position.id}
                    className="flex justify-between items-center p-3 bg-slate-700 rounded-lg"
                  >
                    <div>
                      <span className="font-medium">{position.symbol}</span>
                      <div className="text-sm text-slate-400">
                        {position.amount.toFixed(6)} @ ${position.avgCost.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">${value.toFixed(2)}</div>
                      <div className={`text-sm ${gain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {gain >= 0 ? '+' : ''}${gain.toFixed(2)} ({gainPercent.toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Auto-Trading Bots Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* DCA Bot */}
        <div className="bg-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">DCA Bot</h2>
              {dcaEnabledCount > 0 && (
                <span className="px-2 py-0.5 bg-emerald-600 rounded text-xs animate-pulse">
                  {dcaEnabledCount} active
                </span>
              )}
            </div>
            <button
              onClick={() => setShowDCAForm(!showDCAForm)}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm"
            >
              + Add DCA
            </button>
          </div>

          <p className="text-sm text-slate-400 mb-4">
            Dollar-Cost Averaging automatically buys crypto at regular intervals, reducing the impact of volatility.
          </p>

          {showDCAForm && (
            <div className="mb-4 p-4 bg-slate-700 rounded-lg space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Coin</label>
                  <select
                    value={dcaSymbol}
                    onChange={(e) => setDCASymbol(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg"
                  >
                    {CRYPTO_SYMBOLS.map((c) => (
                      <option key={c.symbol} value={c.symbol}>{c.symbol}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Amount ($)</label>
                  <input
                    type="number"
                    value={dcaAmount}
                    onChange={(e) => setDCAAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Interval</label>
                <select
                  value={dcaInterval}
                  onChange={(e) => setDCAInterval(e.target.value as 'hourly' | 'daily' | 'weekly')}
                  className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg"
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <button
                onClick={handleSaveDCA}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg"
              >
                Save DCA Config
              </button>
            </div>
          )}

          {dcaConfigs.length === 0 ? (
            <div className="text-center py-6 text-slate-500">
              No DCA bots configured. Add one to start dollar-cost averaging!
            </div>
          ) : (
            <div className="space-y-2">
              {dcaConfigs.map((config: DCAConfig) => (
                <div
                  key={config.id}
                  className="flex items-center justify-between p-3 bg-slate-700 rounded-lg"
                >
                  <div>
                    <span className="font-medium">{config.symbol}</span>
                    <span className="text-slate-400 ml-2">
                      ${config.amount}/{config.interval}
                    </span>
                    {config.lastExecuted && (
                      <div className="text-xs text-slate-500">
                        Last: {new Date(config.lastExecuted).toLocaleString()}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => executeDCA(config)}
                      className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs"
                      title="Execute now"
                    >
                      Run
                    </button>
                    <button
                      onClick={() => updateDCAConfig(config.id, { enabled: !config.enabled })}
                      className={`px-3 py-1 rounded text-sm ${
                        config.enabled ? 'bg-emerald-600' : 'bg-slate-600'
                      }`}
                    >
                      {config.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      onClick={() => removeDCAConfig(config.id)}
                      className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
                    >
                      X
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Grid Bot */}
        <div className="bg-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">Grid Trading Bot</h2>
              {gridEnabledCount > 0 && (
                <span className="px-2 py-0.5 bg-blue-600 rounded text-xs animate-pulse">
                  {gridEnabledCount} active
                </span>
              )}
            </div>
            <button
              onClick={() => setShowGridForm(!showGridForm)}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm"
            >
              + Add Grid
            </button>
          </div>

          <p className="text-sm text-slate-400 mb-4">
            Grid trading profits from price oscillations by placing buy orders below and sell orders above the current price.
          </p>

          {showGridForm && (
            <div className="mb-4 p-4 bg-slate-700 rounded-lg space-y-3">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Coin</label>
                <select
                  value={gridSymbol}
                  onChange={(e) => setGridSymbol(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg"
                >
                  {CRYPTO_SYMBOLS.map((c) => (
                    <option key={c.symbol} value={c.symbol}>{c.symbol}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Lower Price ($)</label>
                  <input
                    type="number"
                    value={gridLower}
                    onChange={(e) => setGridLower(e.target.value)}
                    placeholder={quote ? (quote.price * 0.9).toFixed(2) : '0'}
                    className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Upper Price ($)</label>
                  <input
                    type="number"
                    value={gridUpper}
                    onChange={(e) => setGridUpper(e.target.value)}
                    placeholder={quote ? (quote.price * 1.1).toFixed(2) : '0'}
                    className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Grid Levels</label>
                  <input
                    type="number"
                    value={gridLevels}
                    onChange={(e) => setGridLevels(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">$ per Grid</label>
                  <input
                    type="number"
                    value={gridAmount}
                    onChange={(e) => setGridAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg"
                  />
                </div>
              </div>
              <button
                onClick={handleSaveGrid}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Save Grid Config
              </button>
            </div>
          )}

          {gridConfigs.length === 0 ? (
            <div className="text-center py-6 text-slate-500">
              No Grid bots configured. Set up price ranges to profit from volatility!
            </div>
          ) : (
            <div className="space-y-2">
              {gridConfigs.map((config: GridConfig) => (
                <div
                  key={config.id}
                  className="p-3 bg-slate-700 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{config.symbol}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateGridConfig(config.id, { enabled: !config.enabled })}
                        className={`px-3 py-1 rounded text-sm ${
                          config.enabled ? 'bg-blue-600' : 'bg-slate-600'
                        }`}
                      >
                        {config.enabled ? 'ON' : 'OFF'}
                      </button>
                      <button
                        onClick={() => removeGridConfig(config.id)}
                        className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-sm"
                      >
                        X
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-slate-400">
                    Range: ${config.lowerPrice.toFixed(2)} - ${config.upperPrice.toFixed(2)}
                  </div>
                  <div className="text-sm text-slate-400">
                    {config.gridLevels} levels × ${config.amountPerGrid}/grid
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Trades */}
      {cryptoPortfolio.trades.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-6 mt-6">
          <h2 className="text-xl font-semibold mb-4">Recent Trades</h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {cryptoPortfolio.trades.slice(-20).reverse().map((trade: CryptoTradeType) => (
              <div
                key={trade.id}
                className="flex justify-between items-center p-3 bg-slate-700 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    trade.type === 'buy' ? 'bg-emerald-600' : 'bg-red-600'
                  }`}>
                    {trade.type.toUpperCase()}
                  </span>
                  <span className="font-medium">{trade.symbol}</span>
                  <span className="text-slate-400">{trade.amount.toFixed(6)}</span>
                </div>
                <div className="text-right">
                  <div>${trade.total.toFixed(2)}</div>
                  <div className="text-xs text-slate-400">
                    {new Date(trade.date).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
