import { useState } from 'react';
import { useStore } from '../store/useStore';
import { useDailyData, useIntradayData } from '../hooks/useStockData';
import { CandlestickChartSVG } from '../components/charts/CandlestickChartSVG';

type TimeFrame = '1D' | '5D' | '1M' | '3M';

export function Charts() {
  const { watchlist, positions, tradingMode, paperPortfolio } = useStore();

  // Get positions based on trading mode
  const activePositions = tradingMode === 'paper' ? paperPortfolio.positions : positions;

  // Combine all symbols: watchlist + positions
  const allAvailableSymbols = [...new Set([
    ...watchlist,
    ...activePositions.filter((p: { shares: number }) => p.shares > 0).map((p: { symbol: string }) => p.symbol),
  ])];

  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const [timeframe, setTimeframe] = useState<TimeFrame>('1M');
  const [showPatterns, setShowPatterns] = useState(true);
  const [showRSI, setShowRSI] = useState(true);
  const [showMACD, setShowMACD] = useState(false);
  const [showBollingerBands, setShowBollingerBands] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showSMA, setShowSMA] = useState(false);
  const [showEMA, setShowEMA] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Indicator period settings
  const [rsiPeriod, setRsiPeriod] = useState(14);
  const [smaPeriod, setSmaPeriod] = useState(20);
  const [emaPeriod, setEmaPeriod] = useState(12);
  const [bbPeriod, setBbPeriod] = useState(20);
  const [bbStdDev, setBbStdDev] = useState(2);
  const [macdFast, setMacdFast] = useState(12);
  const [macdSlow, setMacdSlow] = useState(26);
  const [macdSignal, setMacdSignal] = useState(9);

  // Get data based on timeframe
  const { data: dailyData, loading: dailyLoading } = useDailyData(
    timeframe !== '1D' ? selectedSymbol : null,
    timeframe === '3M' ? 'full' : 'compact'
  );
  const { data: intradayData, loading: intradayLoading } = useIntradayData(
    timeframe === '1D' ? selectedSymbol : null,
    '15min'
  );

  // Process data based on timeframe
  const chartData = (() => {
    if (timeframe === '1D') {
      return intradayData.slice(-26).map((d) => ({
        date: d.timestamp.split(' ')[1]?.slice(0, 5) || d.timestamp,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }));
    }

    let sliceCount = 30;
    if (timeframe === '5D') sliceCount = 5;
    if (timeframe === '3M') sliceCount = 63;

    return dailyData.slice(-sliceCount).map((d) => ({
      date: d.timestamp.split(' ')[0],
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
  })();

  const loading = timeframe === '1D' ? intradayLoading : dailyLoading;

  // Use the already computed symbols list
  const allSymbols = allAvailableSymbols;

  // Calculate stats
  const latestCandle = chartData[chartData.length - 1];
  const firstCandle = chartData[0];
  const periodChange = latestCandle && firstCandle
    ? latestCandle.close - firstCandle.open
    : 0;
  const periodChangePercent = firstCandle
    ? (periodChange / firstCandle.open) * 100
    : 0;

  return (
    <div className="text-white">
      <h1 className="text-2xl md:text-3xl font-bold mb-6 md:mb-8">Charts</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 md:gap-6">
        {/* Sidebar - Symbol list (stacks above chart on mobile) */}
        <div className="order-first lg:order-none lg:col-span-1">
          <div className="bg-slate-800 rounded-xl p-4">
            <h2 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Symbols</h2>
            <div className="flex flex-wrap gap-1 lg:flex-col lg:space-y-1 lg:gap-0">
              {allSymbols.map((symbol) => (
                <button
                  key={symbol}
                  onClick={() => setSelectedSymbol(symbol)}
                  className={`text-left px-3 py-2 rounded-lg transition-colors text-sm md:text-base lg:w-full ${
                    selectedSymbol === symbol
                      ? 'bg-emerald-600 text-white'
                      : 'hover:bg-slate-700 text-slate-300'
                  }`}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main chart area */}
        <div className="lg:col-span-3 space-y-3 md:space-y-4">
          {/* Chart header */}
          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            <div className="flex flex-wrap justify-between items-center gap-3 md:gap-4">
              <div>
                <h2 className="text-xl md:text-2xl font-bold">{selectedSymbol}</h2>
                {latestCandle && (
                  <div className="flex items-center gap-2 md:gap-3 mt-1">
                    <span className="text-lg md:text-xl">${latestCandle.close.toFixed(2)}</span>
                    <span
                      className={`text-sm ${
                        periodChange >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {periodChange >= 0 ? '+' : ''}
                      {periodChange.toFixed(2)} ({periodChangePercent.toFixed(2)}%)
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 md:gap-4">
                {/* Pattern toggle */}
                <button
                  onClick={() => setShowPatterns(!showPatterns)}
                  className={`text-sm px-3 py-1.5 rounded transition-colors ${
                    showPatterns
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {showPatterns ? 'Patterns On' : 'Patterns Off'}
                </button>

                {/* RSI toggle */}
                <button
                  onClick={() => setShowRSI(!showRSI)}
                  className={`text-sm px-3 py-1.5 rounded transition-colors ${
                    showRSI
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {showRSI ? 'RSI On' : 'RSI Off'}
                </button>

                {/* MACD toggle */}
                <button
                  onClick={() => setShowMACD(!showMACD)}
                  className={`text-sm px-3 py-1.5 rounded transition-colors ${
                    showMACD
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {showMACD ? 'MACD On' : 'MACD Off'}
                </button>

                {/* Bollinger Bands toggle */}
                <button
                  onClick={() => setShowBollingerBands(!showBollingerBands)}
                  className={`text-sm px-3 py-1.5 rounded transition-colors ${
                    showBollingerBands
                      ? 'bg-cyan-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {showBollingerBands ? 'BB On' : 'BB Off'}
                </button>

                {/* Volume toggle */}
                <button
                  onClick={() => setShowVolume(!showVolume)}
                  className={`text-sm px-3 py-1.5 rounded transition-colors ${
                    showVolume
                      ? 'bg-slate-500 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {showVolume ? 'Vol On' : 'Vol Off'}
                </button>

                {/* SMA toggle */}
                <button
                  onClick={() => setShowSMA(!showSMA)}
                  className={`text-sm px-3 py-1.5 rounded transition-colors ${
                    showSMA
                      ? 'bg-amber-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {showSMA ? 'SMA On' : 'SMA Off'}
                </button>

                {/* EMA toggle */}
                <button
                  onClick={() => setShowEMA(!showEMA)}
                  className={`text-sm px-3 py-1.5 rounded transition-colors ${
                    showEMA
                      ? 'bg-pink-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {showEMA ? 'EMA On' : 'EMA Off'}
                </button>

                {/* Settings toggle */}
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className={`text-sm px-3 py-1.5 rounded transition-colors ${
                    showSettings
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  Settings
                </button>

                {/* Timeframe selector */}
                <div className="flex bg-slate-700 rounded-lg p-1">
                  {(['1D', '5D', '1M', '3M'] as TimeFrame[]).map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={`px-3 py-1 rounded text-sm transition-colors ${
                        timeframe === tf
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Indicator Settings Panel */}
          {showSettings && (
            <div className="bg-slate-800 rounded-xl p-4 md:p-6">
              <h3 className="text-base md:text-lg font-semibold mb-3 md:mb-4">Indicator Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
                {/* RSI Settings */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-400">RSI</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-12">Period:</span>
                    <input
                      type="number"
                      value={rsiPeriod}
                      onChange={(e) => setRsiPeriod(Math.max(2, parseInt(e.target.value) || 14))}
                      className="w-20 px-2 py-1 bg-slate-700 rounded text-sm border border-slate-600 focus:border-purple-500 focus:outline-none"
                      min="2"
                      max="50"
                    />
                  </div>
                </div>

                {/* SMA Settings */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-amber-400">SMA</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-12">Period:</span>
                    <input
                      type="number"
                      value={smaPeriod}
                      onChange={(e) => setSmaPeriod(Math.max(2, parseInt(e.target.value) || 20))}
                      className="w-20 px-2 py-1 bg-slate-700 rounded text-sm border border-slate-600 focus:border-amber-500 focus:outline-none"
                      min="2"
                      max="200"
                    />
                  </div>
                </div>

                {/* EMA Settings */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-pink-400">EMA</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-12">Period:</span>
                    <input
                      type="number"
                      value={emaPeriod}
                      onChange={(e) => setEmaPeriod(Math.max(2, parseInt(e.target.value) || 12))}
                      className="w-20 px-2 py-1 bg-slate-700 rounded text-sm border border-slate-600 focus:border-pink-500 focus:outline-none"
                      min="2"
                      max="200"
                    />
                  </div>
                </div>

                {/* Bollinger Bands Settings */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-cyan-400">Bollinger Bands</label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-12">Period:</span>
                    <input
                      type="number"
                      value={bbPeriod}
                      onChange={(e) => setBbPeriod(Math.max(2, parseInt(e.target.value) || 20))}
                      className="w-20 px-2 py-1 bg-slate-700 rounded text-sm border border-slate-600 focus:border-cyan-500 focus:outline-none"
                      min="2"
                      max="50"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-12">Std Dev:</span>
                    <input
                      type="number"
                      value={bbStdDev}
                      onChange={(e) => setBbStdDev(Math.max(0.5, parseFloat(e.target.value) || 2))}
                      className="w-20 px-2 py-1 bg-slate-700 rounded text-sm border border-slate-600 focus:border-cyan-500 focus:outline-none"
                      min="0.5"
                      max="5"
                      step="0.5"
                    />
                  </div>
                </div>

                {/* MACD Settings */}
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-blue-400">MACD</label>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Fast:</span>
                      <input
                        type="number"
                        value={macdFast}
                        onChange={(e) => setMacdFast(Math.max(2, parseInt(e.target.value) || 12))}
                        className="w-16 px-2 py-1 bg-slate-700 rounded text-sm border border-slate-600 focus:border-blue-500 focus:outline-none"
                        min="2"
                        max="50"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Slow:</span>
                      <input
                        type="number"
                        value={macdSlow}
                        onChange={(e) => setMacdSlow(Math.max(2, parseInt(e.target.value) || 26))}
                        className="w-16 px-2 py-1 bg-slate-700 rounded text-sm border border-slate-600 focus:border-blue-500 focus:outline-none"
                        min="2"
                        max="100"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Signal:</span>
                      <input
                        type="number"
                        value={macdSignal}
                        onChange={(e) => setMacdSignal(Math.max(2, parseInt(e.target.value) || 9))}
                        className="w-16 px-2 py-1 bg-slate-700 rounded text-sm border border-slate-600 focus:border-blue-500 focus:outline-none"
                        min="2"
                        max="50"
                      />
                    </div>
                  </div>
                </div>

                {/* Reset button */}
                <div className="flex items-end">
                  <button
                    onClick={() => {
                      setRsiPeriod(14);
                      setSmaPeriod(20);
                      setEmaPeriod(12);
                      setBbPeriod(20);
                      setBbStdDev(2);
                      setMacdFast(12);
                      setMacdSlow(26);
                      setMacdSignal(9);
                    }}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition-colors"
                  >
                    Reset to Defaults
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            {loading ? (
              <div className="flex items-center justify-center h-64 md:h-96">
                <div className="text-slate-400 text-sm md:text-base">Loading chart data...</div>
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex items-center justify-center h-64 md:h-96">
                <div className="text-slate-400 text-sm md:text-base">
                  No data available for {selectedSymbol}
                </div>
              </div>
            ) : (
              <CandlestickChartSVG
                data={chartData}
                height={450 + (showVolume ? 100 : 0) + (showRSI ? 120 : 0) + (showMACD ? 120 : 0)}
                showPatterns={showPatterns}
                showRSI={showRSI}
                rsiPeriod={rsiPeriod}
                showMACD={showMACD}
                macdFast={macdFast}
                macdSlow={macdSlow}
                macdSignal={macdSignal}
                showBollingerBands={showBollingerBands}
                bbPeriod={bbPeriod}
                bbStdDev={bbStdDev}
                showVolume={showVolume}
                showSMA={showSMA}
                smaPeriod={smaPeriod}
                showEMA={showEMA}
                emaPeriod={emaPeriod}
                symbol={selectedSymbol}
              />
            )}
          </div>

          {/* OHLC Stats */}
          {latestCandle && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="bg-slate-800 rounded-xl p-3 md:p-4">
                <div className="text-slate-400 text-xs md:text-sm">Open</div>
                <div className="text-base md:text-lg font-semibold">
                  ${latestCandle.open.toFixed(2)}
                </div>
              </div>
              <div className="bg-slate-800 rounded-xl p-3 md:p-4">
                <div className="text-slate-400 text-xs md:text-sm">High</div>
                <div className="text-base md:text-lg font-semibold text-emerald-400">
                  ${latestCandle.high.toFixed(2)}
                </div>
              </div>
              <div className="bg-slate-800 rounded-xl p-3 md:p-4">
                <div className="text-slate-400 text-xs md:text-sm">Low</div>
                <div className="text-base md:text-lg font-semibold text-red-400">
                  ${latestCandle.low.toFixed(2)}
                </div>
              </div>
              <div className="bg-slate-800 rounded-xl p-3 md:p-4">
                <div className="text-slate-400 text-xs md:text-sm">Close</div>
                <div className="text-base md:text-lg font-semibold">
                  ${latestCandle.close.toFixed(2)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
