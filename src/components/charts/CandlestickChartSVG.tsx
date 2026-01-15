import { useMemo, useState } from 'react';
import { detectPatterns, PATTERN_INFO, type Candle } from '../../services/candlestickPatterns';
import { calculateRSI, getRSISignal, calculateMACD, calculateBollingerBands, calculateSMA, calculateEMA } from '../../services/indicators';
import type { CandlestickPattern } from '../../types';

interface CandleData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CandlestickChartSVGProps {
  data: CandleData[];
  height?: number;
  showPatterns?: boolean;
  showRSI?: boolean;
  rsiPeriod?: number;
  showMACD?: boolean;
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  showBollingerBands?: boolean;
  bbPeriod?: number;
  bbStdDev?: number;
  showVolume?: boolean;
  showSMA?: boolean;
  smaPeriod?: number;
  showEMA?: boolean;
  emaPeriod?: number;
  symbol?: string;
}

const BULLISH_COLOR = '#10b981';
const BEARISH_COLOR = '#ef4444';
const PATTERN_BUY_COLOR = '#10b981';
const PATTERN_SELL_COLOR = '#ef4444';

interface PatternMarker {
  index: number;
  pattern: CandlestickPattern;
  signal: 'buy' | 'sell';
  confidence: number;
}

const RSI_OVERBOUGHT = 70;
const RSI_OVERSOLD = 30;
const RSI_COLOR = '#a855f7'; // Purple

const MACD_LINE_COLOR = '#3b82f6'; // Blue
const MACD_SIGNAL_COLOR = '#f97316'; // Orange
const MACD_HISTOGRAM_POSITIVE = '#10b981'; // Green
const MACD_HISTOGRAM_NEGATIVE = '#ef4444'; // Red

const BB_COLOR = '#06b6d4'; // Cyan
const BB_FILL_COLOR = 'rgba(6, 182, 212, 0.1)'; // Cyan with low opacity

const SMA_COLOR = '#f59e0b'; // Amber/Orange
const EMA_COLOR = '#ec4899'; // Pink

export function CandlestickChartSVG({
  data,
  height = 400,
  showPatterns = true,
  showRSI = false,
  rsiPeriod = 14,
  showMACD = false,
  macdFast = 12,
  macdSlow = 26,
  macdSignal = 9,
  showBollingerBands = false,
  bbPeriod = 20,
  bbStdDev = 2,
  showVolume = false,
  showSMA = false,
  smaPeriod = 20,
  showEMA = false,
  emaPeriod = 12,
  symbol = '',
}: CandlestickChartSVGProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Calculate chart heights based on which indicators are shown
  const indicatorHeight = 100;
  const volumeHeight = 80; // Volume panel is slightly smaller
  const indicatorGap = 20;
  const totalIndicatorSpace =
    (showRSI ? indicatorHeight + indicatorGap : 0) +
    (showMACD ? indicatorHeight + indicatorGap : 0) +
    (showVolume ? volumeHeight + indicatorGap : 0);
  const mainChartHeight = height - totalIndicatorSpace;

  // Calculate panel positions (Volume first, then RSI, then MACD)
  const volumeChartHeight = volumeHeight;
  const volumeChartTop = mainChartHeight + indicatorGap;

  const rsiChartHeight = indicatorHeight;
  const rsiChartTop = showVolume
    ? volumeChartTop + volumeChartHeight + indicatorGap
    : mainChartHeight + indicatorGap;

  const macdChartHeight = indicatorHeight;
  const macdChartTop = showRSI
    ? rsiChartTop + rsiChartHeight + indicatorGap
    : showVolume
    ? volumeChartTop + volumeChartHeight + indicatorGap
    : mainChartHeight + indicatorGap;

  const { processedData, patterns, priceRange, yScale, rsiValues, rsiYScale, macdData, macdYScale, bbData, maxVolume, smaValues, emaValues } = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        processedData: [],
        patterns: [],
        priceRange: { min: 0, max: 0 },
        yScale: () => 0,
        rsiValues: [],
        rsiYScale: () => 0,
        macdData: { macd: [], signal: [], histogram: [] },
        macdYScale: () => 0,
        bbData: { upper: [], middle: [], lower: [] },
        maxVolume: 0,
        smaValues: [],
        emaValues: [],
      };
    }

    // Calculate price range
    const allHighs = data.map((d) => d.high);
    const allLows = data.map((d) => d.low);
    const minPrice = Math.min(...allLows);
    const maxPrice = Math.max(...allHighs);
    const padding = (maxPrice - minPrice) * 0.15;
    const priceMin = minPrice - padding;
    const priceMax = maxPrice + padding;

    // Create Y scale function for main chart
    const effectiveMainHeight = showRSI ? mainChartHeight - 60 : height - 60;
    const yScaleFn = (price: number) => {
      return effectiveMainHeight - ((price - priceMin) / (priceMax - priceMin)) * effectiveMainHeight + 30;
    };

    // Calculate RSI values
    const ohlcData = data.map((d) => ({
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    const rsi = calculateRSI(ohlcData, rsiPeriod);

    // Create Y scale function for RSI (0-100 range)
    const rsiYScaleFn = (value: number) => {
      return rsiChartTop + rsiChartHeight - (value / 100) * rsiChartHeight;
    };

    // Calculate MACD values
    const macd = calculateMACD(ohlcData, macdFast, macdSlow, macdSignal);

    // Calculate MACD Y scale based on actual values
    const allMacdValues = [
      ...macd.macd.filter((v): v is number => v !== null),
      ...macd.signal.filter((v): v is number => v !== null),
      ...macd.histogram.filter((v): v is number => v !== null),
    ];
    const macdMin = allMacdValues.length > 0 ? Math.min(...allMacdValues) : -1;
    const macdMax = allMacdValues.length > 0 ? Math.max(...allMacdValues) : 1;
    const macdRange = Math.max(Math.abs(macdMin), Math.abs(macdMax)) * 1.2; // Symmetric around 0

    const macdYScaleFn = (value: number) => {
      const centerY = macdChartTop + macdChartHeight / 2;
      return centerY - (value / macdRange) * (macdChartHeight / 2);
    };

    // Calculate Bollinger Bands
    const bollingerBands = calculateBollingerBands(ohlcData, bbPeriod, bbStdDev);

    // Calculate SMA and EMA
    const sma = calculateSMA(ohlcData, smaPeriod);
    const ema = calculateEMA(ohlcData, emaPeriod);

    // Calculate volume scale
    const volumes = data.map((d) => d.volume || 0);
    const maxVol = Math.max(...volumes, 1);

    // Detect patterns
    const patternMarkers: PatternMarker[] = [];
    if (showPatterns) {
      const candles: Candle[] = data.map((d) => ({
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }));

      for (let i = 2; i < candles.length; i++) {
        // Need at least 11 candles for breakout detection (10 lookback + 1 current)
        const subset = candles.slice(Math.max(0, i - 10), i + 1);
        const detected = detectPatterns(subset);
        if (detected.length > 0) {
          patternMarkers.push({
            index: i,
            pattern: detected[0].pattern,
            signal: detected[0].signal,
            confidence: detected[0].confidence,
          });
        }
      }
    }

    return {
      processedData: data,
      patterns: patternMarkers,
      priceRange: { min: priceMin, max: priceMax },
      yScale: yScaleFn,
      rsiValues: rsi,
      rsiYScale: rsiYScaleFn,
      macdData: macd,
      macdYScale: macdYScaleFn,
      bbData: bollingerBands,
      maxVolume: maxVol,
      smaValues: sma,
      emaValues: ema,
    };
  }, [data, height, showPatterns, showRSI, showMACD, showVolume, mainChartHeight, rsiChartTop, rsiChartHeight, rsiPeriod, macdChartTop, macdChartHeight, volumeChartTop, volumeChartHeight, smaPeriod, emaPeriod, macdFast, macdSlow, macdSignal, bbPeriod, bbStdDev]);

  if (processedData.length === 0) {
    return (
      <div className="flex items-center justify-center text-slate-400" style={{ height }}>
        No chart data available
      </div>
    );
  }

  const candleWidth = Math.min(80 / processedData.length, 3);
  const candleGap = (100 - candleWidth * processedData.length) / (processedData.length + 1);

  const getCandleX = (index: number) => {
    return candleGap + index * (candleWidth + candleGap);
  };

  const hoveredCandle = hoveredIndex !== null ? processedData[hoveredIndex] : null;
  const hoveredPattern = hoveredIndex !== null
    ? patterns.find((p) => p.index === hoveredIndex)
    : null;

  // Generate Y-axis labels
  const priceStep = (priceRange.max - priceRange.min) / 5;
  const yAxisLabels = Array.from({ length: 6 }, (_, i) => priceRange.min + priceStep * i);

  return (
    <div className="relative">
      {/* Header */}
      {symbol && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-lg font-semibold">{symbol}</span>
          {patterns.length > 0 && (
            <span className="text-xs text-slate-400">
              {patterns.length} pattern{patterns.length !== 1 ? 's' : ''} detected
            </span>
          )}
        </div>
      )}

      {/* Chart */}
      <svg
        width="100%"
        height={showRSI ? height : height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="overflow-visible"
      >
        {/* Grid lines */}
        {yAxisLabels.map((price, i) => (
          <g key={i}>
            <line
              x1="0"
              y1={yScale(price)}
              x2="100"
              y2={yScale(price)}
              stroke="#374151"
              strokeWidth="0.1"
              strokeDasharray="0.5,0.5"
            />
          </g>
        ))}

        {/* Bollinger Bands */}
        {showBollingerBands && (
          <g>
            {/* Filled area between upper and lower bands */}
            <path
              d={(() => {
                const upperPoints: string[] = [];
                const lowerPoints: string[] = [];

                for (let i = 0; i < bbData.upper.length; i++) {
                  if (bbData.upper[i] !== null && bbData.lower[i] !== null) {
                    const x = getCandleX(i) + candleWidth / 2;
                    upperPoints.push(`${x},${yScale(bbData.upper[i]!)}`);
                    lowerPoints.unshift(`${x},${yScale(bbData.lower[i]!)}`);
                  }
                }

                if (upperPoints.length === 0) return '';
                return `M ${upperPoints.join(' L ')} L ${lowerPoints.join(' L ')} Z`;
              })()}
              fill={BB_FILL_COLOR}
            />

            {/* Upper band line */}
            <polyline
              fill="none"
              stroke={BB_COLOR}
              strokeWidth="0.2"
              opacity="0.8"
              points={bbData.upper
                .map((val, i) => {
                  if (val === null) return null;
                  const x = getCandleX(i) + candleWidth / 2;
                  return `${x},${yScale(val)}`;
                })
                .filter(Boolean)
                .join(' ')}
            />

            {/* Middle band (SMA) line */}
            <polyline
              fill="none"
              stroke={BB_COLOR}
              strokeWidth="0.25"
              strokeDasharray="0.5,0.3"
              points={bbData.middle
                .map((val, i) => {
                  if (val === null) return null;
                  const x = getCandleX(i) + candleWidth / 2;
                  return `${x},${yScale(val)}`;
                })
                .filter(Boolean)
                .join(' ')}
            />

            {/* Lower band line */}
            <polyline
              fill="none"
              stroke={BB_COLOR}
              strokeWidth="0.2"
              opacity="0.8"
              points={bbData.lower
                .map((val, i) => {
                  if (val === null) return null;
                  const x = getCandleX(i) + candleWidth / 2;
                  return `${x},${yScale(val)}`;
                })
                .filter(Boolean)
                .join(' ')}
            />
          </g>
        )}

        {/* SMA Line */}
        {showSMA && (
          <polyline
            fill="none"
            stroke={SMA_COLOR}
            strokeWidth="0.3"
            points={smaValues
              .map((val, i) => {
                if (val === null) return null;
                const x = getCandleX(i) + candleWidth / 2;
                return `${x},${yScale(val)}`;
              })
              .filter(Boolean)
              .join(' ')}
          />
        )}

        {/* EMA Line */}
        {showEMA && (
          <polyline
            fill="none"
            stroke={EMA_COLOR}
            strokeWidth="0.3"
            points={emaValues
              .map((val, i) => {
                if (val === null) return null;
                const x = getCandleX(i) + candleWidth / 2;
                return `${x},${yScale(val)}`;
              })
              .filter(Boolean)
              .join(' ')}
          />
        )}

        {/* Candlesticks */}
        {processedData.map((candle, index) => {
          const x = getCandleX(index);
          const isBullish = candle.close >= candle.open;
          const color = isBullish ? BULLISH_COLOR : BEARISH_COLOR;

          const bodyTop = yScale(Math.max(candle.open, candle.close));
          const bodyBottom = yScale(Math.min(candle.open, candle.close));
          const bodyHeight = Math.max(bodyBottom - bodyTop, 0.5);

          const wickTop = yScale(candle.high);
          const wickBottom = yScale(candle.low);

          const patternMarker = patterns.find((p) => p.index === index);
          const isHovered = hoveredIndex === index;

          return (
            <g
              key={index}
              onMouseEnter={() => {
                setHoveredIndex(index);
              }}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{ cursor: 'crosshair' }}
            >
              {/* Hover highlight */}
              {isHovered && (
                <rect
                  x={x - candleWidth / 2}
                  y="30"
                  width={candleWidth * 2}
                  height={height - 60}
                  fill="rgba(255,255,255,0.05)"
                />
              )}

              {/* Upper wick */}
              <line
                x1={x + candleWidth / 2}
                y1={wickTop}
                x2={x + candleWidth / 2}
                y2={bodyTop}
                stroke={color}
                strokeWidth="0.15"
              />

              {/* Lower wick */}
              <line
                x1={x + candleWidth / 2}
                y1={bodyBottom}
                x2={x + candleWidth / 2}
                y2={wickBottom}
                stroke={color}
                strokeWidth="0.15"
              />

              {/* Body */}
              <rect
                x={x}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                fill={isBullish ? 'transparent' : color}
                stroke={color}
                strokeWidth="0.15"
              />

              {/* Pattern marker */}
              {patternMarker && (
                <g>
                  {/* Arrow indicator */}
                  <polygon
                    points={
                      patternMarker.signal === 'buy'
                        ? `${x + candleWidth / 2},${wickBottom + 3} ${x + candleWidth / 2 - 1},${wickBottom + 5} ${x + candleWidth / 2 + 1},${wickBottom + 5}`
                        : `${x + candleWidth / 2},${wickTop - 3} ${x + candleWidth / 2 - 1},${wickTop - 5} ${x + candleWidth / 2 + 1},${wickTop - 5}`
                    }
                    fill={patternMarker.signal === 'buy' ? PATTERN_BUY_COLOR : PATTERN_SELL_COLOR}
                  />
                  {/* Glow effect */}
                  <circle
                    cx={x + candleWidth / 2}
                    cy={patternMarker.signal === 'buy' ? wickBottom + 4 : wickTop - 4}
                    r="2"
                    fill={patternMarker.signal === 'buy' ? PATTERN_BUY_COLOR : PATTERN_SELL_COLOR}
                    opacity="0.3"
                  />
                </g>
              )}
            </g>
          );
        })}

        {/* Volume Panel */}
        {showVolume && (
          <g>
            {/* Volume background */}
            <rect
              x="0"
              y={volumeChartTop}
              width="100"
              height={volumeChartHeight}
              fill="#1e293b"
              opacity="0.5"
            />

            {/* Volume bars */}
            {processedData.map((candle, i) => {
              const volume = candle.volume || 0;
              if (volume === 0) return null;
              const x = getCandleX(i);
              const barHeight = (volume / maxVolume) * volumeChartHeight;
              const y = volumeChartTop + volumeChartHeight - barHeight;
              const isBullish = candle.close >= candle.open;
              const isHovered = hoveredIndex === i;

              return (
                <rect
                  key={`vol-${i}`}
                  x={x}
                  y={y}
                  width={candleWidth}
                  height={barHeight}
                  fill={isBullish ? BULLISH_COLOR : BEARISH_COLOR}
                  opacity={isHovered ? 0.9 : 0.6}
                />
              );
            })}
          </g>
        )}

        {/* RSI Panel */}
        {showRSI && (
          <g>
            {/* RSI background */}
            <rect
              x="0"
              y={rsiChartTop}
              width="100"
              height={rsiChartHeight}
              fill="#1e293b"
              opacity="0.5"
            />

            {/* RSI overbought line (70) */}
            <line
              x1="0"
              y1={rsiYScale(RSI_OVERBOUGHT)}
              x2="100"
              y2={rsiYScale(RSI_OVERBOUGHT)}
              stroke="#ef4444"
              strokeWidth="0.1"
              strokeDasharray="0.5,0.5"
            />

            {/* RSI oversold line (30) */}
            <line
              x1="0"
              y1={rsiYScale(RSI_OVERSOLD)}
              x2="100"
              y2={rsiYScale(RSI_OVERSOLD)}
              stroke="#10b981"
              strokeWidth="0.1"
              strokeDasharray="0.5,0.5"
            />

            {/* RSI center line (50) */}
            <line
              x1="0"
              y1={rsiYScale(50)}
              x2="100"
              y2={rsiYScale(50)}
              stroke="#374151"
              strokeWidth="0.1"
              strokeDasharray="0.3,0.3"
            />

            {/* RSI line */}
            <polyline
              fill="none"
              stroke={RSI_COLOR}
              strokeWidth="0.3"
              points={rsiValues
                .map((rsi, i) => {
                  if (rsi === null) return null;
                  const x = getCandleX(i) + candleWidth / 2;
                  const y = rsiYScale(rsi);
                  return `${x},${y}`;
                })
                .filter(Boolean)
                .join(' ')}
            />

            {/* RSI dots at each candle */}
            {rsiValues.map((rsi, i) => {
              if (rsi === null) return null;
              const x = getCandleX(i) + candleWidth / 2;
              const y = rsiYScale(rsi);
              const isHovered = hoveredIndex === i;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={isHovered ? 0.8 : 0.4}
                  fill={RSI_COLOR}
                  opacity={isHovered ? 1 : 0.7}
                />
              );
            })}
          </g>
        )}

        {/* MACD Panel */}
        {showMACD && (
          <g>
            {/* MACD background */}
            <rect
              x="0"
              y={macdChartTop}
              width="100"
              height={macdChartHeight}
              fill="#1e293b"
              opacity="0.5"
            />

            {/* MACD zero line */}
            <line
              x1="0"
              y1={macdYScale(0)}
              x2="100"
              y2={macdYScale(0)}
              stroke="#374151"
              strokeWidth="0.15"
            />

            {/* MACD histogram bars */}
            {macdData.histogram.map((hist, i) => {
              if (hist === null) return null;
              const x = getCandleX(i);
              const barHeight = Math.abs(macdYScale(0) - macdYScale(hist));
              const y = hist >= 0 ? macdYScale(hist) : macdYScale(0);
              return (
                <rect
                  key={`hist-${i}`}
                  x={x}
                  y={y}
                  width={candleWidth}
                  height={barHeight || 0.5}
                  fill={hist >= 0 ? MACD_HISTOGRAM_POSITIVE : MACD_HISTOGRAM_NEGATIVE}
                  opacity={hoveredIndex === i ? 1 : 0.7}
                />
              );
            })}

            {/* MACD line */}
            <polyline
              fill="none"
              stroke={MACD_LINE_COLOR}
              strokeWidth="0.3"
              points={macdData.macd
                .map((val, i) => {
                  if (val === null) return null;
                  const x = getCandleX(i) + candleWidth / 2;
                  const y = macdYScale(val);
                  return `${x},${y}`;
                })
                .filter(Boolean)
                .join(' ')}
            />

            {/* Signal line */}
            <polyline
              fill="none"
              stroke={MACD_SIGNAL_COLOR}
              strokeWidth="0.3"
              points={macdData.signal
                .map((val, i) => {
                  if (val === null) return null;
                  const x = getCandleX(i) + candleWidth / 2;
                  const y = macdYScale(val);
                  return `${x},${y}`;
                })
                .filter(Boolean)
                .join(' ')}
            />
          </g>
        )}
      </svg>

      {/* Y-axis labels (outside SVG for better text rendering) */}
      <div className="absolute left-0 top-0 h-full pointer-events-none" style={{ width: '50px' }}>
        {yAxisLabels.map((price, i) => (
          <div
            key={i}
            className="absolute text-xs text-slate-500 -translate-y-1/2"
            style={{ top: `${(yScale(price) / height) * 100}%`, left: '-45px' }}
          >
            ${price.toFixed(0)}
          </div>
        ))}
      </div>

      {/* Volume Y-axis labels */}
      {showVolume && (
        <div className="absolute right-0 top-0 h-full pointer-events-none" style={{ width: '40px' }}>
          <div
            className="absolute text-xs text-slate-400 font-semibold"
            style={{ top: `${(volumeChartTop / height) * 100}%`, right: '-35px' }}
          >
            Vol
          </div>
          <div
            className="absolute text-xs text-slate-500"
            style={{ top: `${((volumeChartTop + volumeChartHeight) / height) * 100}%`, right: '-25px', transform: 'translateY(-100%)' }}
          >
            0
          </div>
        </div>
      )}

      {/* RSI Y-axis labels */}
      {showRSI && (
        <div className="absolute right-0 top-0 h-full pointer-events-none" style={{ width: '40px' }}>
          {[RSI_OVERBOUGHT, 50, RSI_OVERSOLD].map((value) => (
            <div
              key={value}
              className={`absolute text-xs -translate-y-1/2 ${
                value === RSI_OVERBOUGHT ? 'text-red-400' : value === RSI_OVERSOLD ? 'text-emerald-400' : 'text-slate-500'
              }`}
              style={{ top: `${(rsiYScale(value) / height) * 100}%`, right: '-35px' }}
            >
              {value}
            </div>
          ))}
          <div
            className="absolute text-xs text-purple-400 font-semibold"
            style={{ top: `${(rsiChartTop / height) * 100}%`, right: '-35px' }}
          >
            RSI
          </div>
        </div>
      )}

      {/* MACD Y-axis labels */}
      {showMACD && (
        <div className="absolute right-0 top-0 h-full pointer-events-none" style={{ width: '40px' }}>
          <div
            className="absolute text-xs text-blue-400 font-semibold"
            style={{ top: `${(macdChartTop / height) * 100}%`, right: '-40px' }}
          >
            MACD
          </div>
          <div
            className="absolute text-xs text-slate-500 -translate-y-1/2"
            style={{ top: `${(macdYScale(0) / height) * 100}%`, right: '-25px' }}
          >
            0
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hoveredCandle && (
        <div
          className="absolute z-10 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-lg pointer-events-none"
          style={{
            left: `${getCandleX(hoveredIndex!) + 5}%`,
            top: '40px',
            transform: hoveredIndex! > processedData.length / 2 ? 'translateX(-110%)' : 'translateX(0)',
          }}
        >
          <div className="text-sm text-slate-400 mb-2">{hoveredCandle.date}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-400">O:</span>
            <span className="text-white">${hoveredCandle.open.toFixed(2)}</span>
            <span className="text-slate-400">H:</span>
            <span className="text-white">${hoveredCandle.high.toFixed(2)}</span>
            <span className="text-slate-400">L:</span>
            <span className="text-white">${hoveredCandle.low.toFixed(2)}</span>
            <span className="text-slate-400">C:</span>
            <span className="text-white">${hoveredCandle.close.toFixed(2)}</span>
            {showVolume && hoveredCandle.volume !== undefined && (
              <>
                <span className="text-slate-400">Vol:</span>
                <span className="text-white">
                  {hoveredCandle.volume >= 1000000
                    ? `${(hoveredCandle.volume / 1000000).toFixed(2)}M`
                    : hoveredCandle.volume >= 1000
                    ? `${(hoveredCandle.volume / 1000).toFixed(1)}K`
                    : hoveredCandle.volume.toLocaleString()}
                </span>
              </>
            )}
            {showSMA && hoveredIndex !== null && smaValues[hoveredIndex] !== null && (
              <>
                <span className="text-slate-400">SMA({smaPeriod}):</span>
                <span className="text-amber-400">${smaValues[hoveredIndex]!.toFixed(2)}</span>
              </>
            )}
            {showEMA && hoveredIndex !== null && emaValues[hoveredIndex] !== null && (
              <>
                <span className="text-slate-400">EMA({emaPeriod}):</span>
                <span className="text-pink-400">${emaValues[hoveredIndex]!.toFixed(2)}</span>
              </>
            )}
          </div>
          {/* RSI value in tooltip */}
          {showRSI && hoveredIndex !== null && rsiValues[hoveredIndex] !== null && (
            <div className="mt-2 pt-2 border-t border-slate-600">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">RSI:</span>
                <span
                  className={`text-sm font-semibold ${
                    rsiValues[hoveredIndex]! >= RSI_OVERBOUGHT
                      ? 'text-red-400'
                      : rsiValues[hoveredIndex]! <= RSI_OVERSOLD
                      ? 'text-emerald-400'
                      : 'text-purple-400'
                  }`}
                >
                  {rsiValues[hoveredIndex]!.toFixed(1)}
                </span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    rsiValues[hoveredIndex]! >= RSI_OVERBOUGHT
                      ? 'bg-red-900/50 text-red-300'
                      : rsiValues[hoveredIndex]! <= RSI_OVERSOLD
                      ? 'bg-emerald-900/50 text-emerald-300'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {getRSISignal(rsiValues[hoveredIndex]!).level}
                </span>
              </div>
            </div>
          )}
          {/* MACD values in tooltip */}
          {showMACD && hoveredIndex !== null && macdData.macd[hoveredIndex] !== null && (
            <div className="mt-2 pt-2 border-t border-slate-600">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <span className="text-slate-400">MACD:</span>
                <span className="text-blue-400 font-semibold">
                  {macdData.macd[hoveredIndex]!.toFixed(2)}
                </span>
                {macdData.signal[hoveredIndex] !== null && (
                  <>
                    <span className="text-slate-400">Signal:</span>
                    <span className="text-orange-400 font-semibold">
                      {macdData.signal[hoveredIndex]!.toFixed(2)}
                    </span>
                  </>
                )}
                {macdData.histogram[hoveredIndex] !== null && (
                  <>
                    <span className="text-slate-400">Hist:</span>
                    <span
                      className={`font-semibold ${
                        macdData.histogram[hoveredIndex]! >= 0
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {macdData.histogram[hoveredIndex]!.toFixed(2)}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
          {/* Bollinger Bands values in tooltip */}
          {showBollingerBands && hoveredIndex !== null && bbData.middle[hoveredIndex] !== null && (
            <div className="mt-2 pt-2 border-t border-slate-600">
              <div className="text-xs text-cyan-400 font-semibold mb-1">Bollinger Bands</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <span className="text-slate-400">Upper:</span>
                <span className="text-cyan-400">${bbData.upper[hoveredIndex]!.toFixed(2)}</span>
                <span className="text-slate-400">Middle:</span>
                <span className="text-cyan-400">${bbData.middle[hoveredIndex]!.toFixed(2)}</span>
                <span className="text-slate-400">Lower:</span>
                <span className="text-cyan-400">${bbData.lower[hoveredIndex]!.toFixed(2)}</span>
              </div>
            </div>
          )}
          {hoveredPattern && (
            <div className="mt-2 pt-2 border-t border-slate-600">
              <div
                className={`text-xs px-2 py-1 rounded inline-block ${
                  hoveredPattern.signal === 'buy'
                    ? 'bg-emerald-900 text-emerald-300'
                    : 'bg-red-900 text-red-300'
                }`}
              >
                {PATTERN_INFO[hoveredPattern.pattern]?.name}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {hoveredPattern.confidence}% confidence
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pattern legend */}
      {showPatterns && patterns.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {patterns.slice(-5).map((p, i) => (
            <div
              key={i}
              className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                p.signal === 'buy'
                  ? 'bg-emerald-900/50 text-emerald-300'
                  : 'bg-red-900/50 text-red-300'
              }`}
            >
              <span>{p.signal === 'buy' ? '▲' : '▼'}</span>
              <span>{PATTERN_INFO[p.pattern]?.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
