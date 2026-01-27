import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { getBinancePrice, getBinanceCandles } from '../services/binanceApi';
import { useDCABot } from '../hooks/useDCABot';
import { useGridBot } from '../hooks/useGridBot';
import type { PriceHistory } from '../types';
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
  const { enabledCount: dcaEnabledCount } = useDCABot();
  const { enabledCount: gridEnabledCount } = useGridBot();

  // Fetch price
  const fetchPrice = useCallback(async () => {
    const price = await getBinancePrice(selectedSymbol);
    if (price) {
      // For now, we don't have 24h change from simple price endpoint
      // In a full implementation, you'd use /ticker/24hr
      setQuote({ price, change24h: 0, changePercent24h: 0 });
    }
  }, [selectedSymbol]);

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

    const priceInterval = setInterval(fetchPrice, 10000); // Update price every 10s
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

        // Add trade record
        addCryptoTrade({
          id: crypto.randomUUID(),
          symbol: selectedSymbol,
          type: 'buy',
          amount: cryptoAmount,
          price: quote.price,
          total: usdAmount,
          date: new Date(),
        });

        // Deduct USD from balance
        setCryptoUsdBalance(cryptoPortfolio.usdBalance - usdAmount);

        // Update or create position
        const existingPosition = cryptoPortfolio.positions.find(p => p.symbol === selectedSymbol);
        if (existingPosition) {
          const newAmount = existingPosition.amount + cryptoAmount;
          const newAvgCost = ((existingPosition.avgCost * existingPosition.amount) + usdAmount) / newAmount;
          updateCryptoPosition(existingPosition.id, {
            amount: newAmount,
            avgCost: newAvgCost,
            currentPrice: quote.price,
          });
        } else {
          // Create new position
          addCryptoPosition({
            id: crypto.randomUUID(),
            symbol: selectedSymbol,
            amount: cryptoAmount,
            avgCost: quote.price,
            currentPrice: quote.price,
          });
        }

        setOrderStatus({
          type: 'success',
          message: `Bought ${cryptoAmount.toFixed(6)} ${selectedSymbol} for $${usdAmount.toFixed(2)}`,
        });
      } else {
        const position = cryptoPortfolio.positions.find(p => p.symbol === selectedSymbol);
        const cryptoToSell = usdAmount / quote.price;

        if (!position || position.amount < cryptoToSell) {
          throw new Error('Insufficient crypto balance');
        }

        // Add trade record
        addCryptoTrade({
          id: crypto.randomUUID(),
          symbol: selectedSymbol,
          type: 'sell',
          amount: cryptoToSell,
          price: quote.price,
          total: usdAmount,
          date: new Date(),
        });

        // Add USD to balance
        setCryptoUsdBalance(cryptoPortfolio.usdBalance + usdAmount);

        // Update position
        updateCryptoPosition(position.id, {
          amount: position.amount - cryptoToSell,
          currentPrice: quote.price,
        });

        setOrderStatus({
          type: 'success',
          message: `Sold ${cryptoToSell.toFixed(6)} ${selectedSymbol} for $${usdAmount.toFixed(2)}`,
        });
      }

      setAmount('');
    } catch (error) {
      setOrderStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Trade failed',
      });
    }

    setSubmitting(false);
  };

  // Handle DCA config save
  const handleSaveDCA = () => {
    addDCAConfig({
      id: crypto.randomUUID(),
      symbol: dcaSymbol,
      amount: parseFloat(dcaAmount),
      interval: dcaInterval,
      enabled: true,
    });
    setShowDCAForm(false);
    setDCAAmount('100');
  };

  // Handle Grid config save
  const handleSaveGrid = () => {
    addGridConfig({
      id: crypto.randomUUID(),
      symbol: gridSymbol,
      lowerPrice: parseFloat(gridLower),
      upperPrice: parseFloat(gridUpper),
      gridLevels: parseInt(gridLevels),
      amountPerGrid: parseFloat(gridAmount),
      enabled: true,
      activeOrders: [],
    });
    setShowGridForm(false);
  };

  const selectedCrypto = CRYPTO_SYMBOLS.find(c => c.symbol === selectedSymbol);
  const position = cryptoPortfolio.positions.find(p => p.symbol === selectedSymbol);

  return (
    <div className="text-white">
      <h1 className="text-3xl font-bold mb-6">Crypto Trade</h1>

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
                <XAxis
                  dataKey="date"
                  stroke="#9ca3af"
                  tick={{ fontSize: 12 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke="#9ca3af"
                  tick={{ fontSize: 12 }}
                  domain={['auto', 'auto']}
                  tickFormatter={(value) => `$${value.toLocaleString()}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: 'none',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Price']}
                  labelFormatter={(label, payload) => payload[0]?.payload?.fullDate || label}
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
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trade Form */}
        <div className="bg-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Trade {selectedSymbol}</h2>

          <div className="flex mb-4">
            <button
              onClick={() => setTradeType('buy')}
              className={`flex-1 py-2 rounded-l-lg font-medium transition-colors ${
                tradeType === 'buy'
                  ? 'bg-emerald-600'
                  : 'bg-slate-700 hover:bg-slate-600'
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setTradeType('sell')}
              className={`flex-1 py-2 rounded-r-lg font-medium transition-colors ${
                tradeType === 'sell'
                  ? 'bg-red-600'
                  : 'bg-slate-700 hover:bg-slate-600'
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
                placeholder="Enter USD amount"
                className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg focus:outline-none focus:border-emerald-500"
                min="0"
                step="0.01"
              />
            </div>

            {quote && amount && (
              <div className="text-sm text-slate-400">
                {tradeType === 'buy' ? 'You will receive' : 'You will sell'}:{' '}
                <span className="text-white font-medium">
                  {(parseFloat(amount) / quote.price).toFixed(6)} {selectedSymbol}
                </span>
              </div>
            )}

            <div className="flex justify-between text-sm text-slate-400">
              <span>Available:</span>
              <span className="text-white">
                {tradeType === 'buy'
                  ? `$${cryptoPortfolio.usdBalance.toFixed(2)}`
                  : `${position?.amount.toFixed(6) || '0'} ${selectedSymbol}`}
              </span>
            </div>

            <button
              type="submit"
              disabled={submitting || !amount || !quote}
              className={`w-full py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                tradeType === 'buy'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {submitting ? 'Processing...' : `${tradeType === 'buy' ? 'Buy' : 'Sell'} ${selectedSymbol}`}
            </button>

            {orderStatus && (
              <div
                className={`p-3 rounded-lg ${
                  orderStatus.type === 'success'
                    ? 'bg-emerald-900/50 text-emerald-300'
                    : 'bg-red-900/50 text-red-300'
                }`}
              >
                {orderStatus.message}
              </div>
            )}
          </form>
        </div>

        {/* Crypto Positions */}
        <div className="bg-slate-800 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Crypto Portfolio</h2>
            <div className="text-slate-400">
              USD: <span className="text-white font-medium">${cryptoPortfolio.usdBalance.toFixed(2)}</span>
            </div>
          </div>

          {cryptoPortfolio.positions.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              No crypto positions yet. Start trading!
            </div>
          ) : (
            <div className="space-y-3">
              {cryptoPortfolio.positions.map((pos) => {
                const value = pos.amount * pos.currentPrice;
                const gain = value - (pos.amount * pos.avgCost);
                const gainPercent = ((pos.currentPrice - pos.avgCost) / pos.avgCost) * 100;

                return (
                  <div
                    key={pos.id}
                    className="flex items-center justify-between p-3 bg-slate-700 rounded-lg"
                  >
                    <div>
                      <div className="font-medium">{pos.symbol}</div>
                      <div className="text-sm text-slate-400">
                        {pos.amount.toFixed(6)} @ ${pos.avgCost.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">${value.toFixed(2)}</div>
                      <div
                        className={`text-sm ${
                          gain >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
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
            <div className="text-center py-6 text-slate-400">
              No DCA bots configured. Add one to start dollar-cost averaging!
            </div>
          ) : (
            <div className="space-y-2">
              {dcaConfigs.map((config) => (
                <div
                  key={config.id}
                  className="flex items-center justify-between p-3 bg-slate-700 rounded-lg"
                >
                  <div>
                    <span className="font-medium">{config.symbol}</span>
                    <span className="text-slate-400 ml-2">
                      ${config.amount}/{config.interval}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateDCAConfig(config.id, { enabled: !config.enabled })}
                      className={`px-3 py-1 rounded text-sm ${
                        config.enabled
                          ? 'bg-emerald-600'
                          : 'bg-slate-600'
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
                <span className="px-2 py-0.5 bg-emerald-600 rounded text-xs animate-pulse">
                  {gridEnabledCount} active
                </span>
              )}
            </div>
            <button
              onClick={() => setShowGridForm(!showGridForm)}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm"
            >
              + Add Grid
            </button>
          </div>

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
                  <label className="block text-sm text-slate-400 mb-1">Lower Price</label>
                  <input
                    type="number"
                    value={gridLower}
                    onChange={(e) => setGridLower(e.target.value)}
                    placeholder="e.g., 60000"
                    className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Upper Price</label>
                  <input
                    type="number"
                    value={gridUpper}
                    onChange={(e) => setGridUpper(e.target.value)}
                    placeholder="e.g., 70000"
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
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg"
              >
                Save Grid Config
              </button>
            </div>
          )}

          {gridConfigs.length === 0 ? (
            <div className="text-center py-6 text-slate-400">
              No grid bots configured. Grid trading works best in sideways markets!
            </div>
          ) : (
            <div className="space-y-2">
              {gridConfigs.map((config) => (
                <div
                  key={config.id}
                  className="flex items-center justify-between p-3 bg-slate-700 rounded-lg"
                >
                  <div>
                    <span className="font-medium">{config.symbol}</span>
                    <span className="text-slate-400 ml-2">
                      ${config.lowerPrice.toLocaleString()} - ${config.upperPrice.toLocaleString()}
                    </span>
                    <span className="text-slate-500 ml-2 text-sm">
                      ({config.gridLevels} grids)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateGridConfig(config.id, { enabled: !config.enabled })}
                      className={`px-3 py-1 rounded text-sm ${
                        config.enabled
                          ? 'bg-emerald-600'
                          : 'bg-slate-600'
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
