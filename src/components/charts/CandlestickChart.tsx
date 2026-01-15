import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { detectPatterns, PATTERN_INFO, type Candle } from '../../services/candlestickPatterns';
import type { CandlestickPattern } from '../../types';

interface CandleData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface ProcessedCandle extends CandleData {
  // For the body (filled rectangle)
  bodyLow: number;
  bodyHigh: number;
  bodyHeight: number;
  // For the wicks
  wickHigh: number;
  wickLow: number;
  // Color
  fill: string;
  stroke: string;
  // Pattern detection
  pattern?: CandlestickPattern;
  patternSignal?: 'buy' | 'sell';
}

interface CandlestickChartProps {
  data: CandleData[];
  height?: number;
  showVolume?: boolean;
  showPatterns?: boolean;
}

const BULLISH_COLOR = '#10b981';
const BEARISH_COLOR = '#ef4444';

// Custom candlestick shape
const CandlestickShape = (props: any) => {
  const { x, y, width, height, payload } = props;

  if (!payload) return null;

  const {
    open,
    high,
    low,
    close,
    bodyLow,
    bodyHigh,
    fill,
    stroke,
    pattern,
    patternSignal,
  } = payload;

  const isBullish = close >= open;
  const candleWidth = Math.max(width * 0.8, 4);
  const wickWidth = 1;

  // Calculate positions
  const xCenter = x + width / 2;
  const xLeft = xCenter - candleWidth / 2;

  // Scale factor for positioning (y is already scaled by recharts)
  const yScale = height / (bodyHigh - bodyLow || 1);

  const bodyTop = y;
  const bodyBottom = y + height;
  const bodyH = Math.max(Math.abs(bodyBottom - bodyTop), 1);

  // Wick positions relative to the bar
  const wickTop = y - (high - Math.max(open, close)) * yScale;
  const wickBottom = y + height + (Math.min(open, close) - low) * yScale;

  return (
    <g>
      {/* Upper wick */}
      <line
        x1={xCenter}
        y1={wickTop}
        x2={xCenter}
        y2={bodyTop}
        stroke={stroke}
        strokeWidth={wickWidth}
      />
      {/* Lower wick */}
      <line
        x1={xCenter}
        y1={bodyBottom}
        x2={xCenter}
        y2={wickBottom}
        stroke={stroke}
        strokeWidth={wickWidth}
      />
      {/* Body */}
      <rect
        x={xLeft}
        y={bodyTop}
        width={candleWidth}
        height={bodyH}
        fill={isBullish ? 'transparent' : fill}
        stroke={stroke}
        strokeWidth={1}
      />
      {/* Pattern indicator */}
      {pattern && (
        <g>
          <circle
            cx={xCenter}
            cy={patternSignal === 'buy' ? wickBottom + 8 : wickTop - 8}
            r={4}
            fill={patternSignal === 'buy' ? BULLISH_COLOR : BEARISH_COLOR}
          />
          <text
            x={xCenter}
            y={patternSignal === 'buy' ? wickBottom + 22 : wickTop - 18}
            textAnchor="middle"
            fill={patternSignal === 'buy' ? BULLISH_COLOR : BEARISH_COLOR}
            fontSize={8}
            fontWeight="bold"
          >
            {patternSignal === 'buy' ? '▲' : '▼'}
          </text>
        </g>
      )}
    </g>
  );
};

// Custom tooltip
const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload[0]) return null;

  const data = payload[0].payload;
  const isBullish = data.close >= data.open;
  const change = data.close - data.open;
  const changePercent = ((change / data.open) * 100).toFixed(2);

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-lg">
      <div className="text-sm text-slate-400 mb-2">{data.date}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-slate-400">Open:</span>
        <span className="text-white">${data.open.toFixed(2)}</span>
        <span className="text-slate-400">High:</span>
        <span className="text-white">${data.high.toFixed(2)}</span>
        <span className="text-slate-400">Low:</span>
        <span className="text-white">${data.low.toFixed(2)}</span>
        <span className="text-slate-400">Close:</span>
        <span className="text-white">${data.close.toFixed(2)}</span>
        <span className="text-slate-400">Change:</span>
        <span className={isBullish ? 'text-emerald-400' : 'text-red-400'}>
          {isBullish ? '+' : ''}{change.toFixed(2)} ({isBullish ? '+' : ''}{changePercent}%)
        </span>
      </div>
      {data.pattern && (
        <div className="mt-2 pt-2 border-t border-slate-600">
          <span
            className={`text-xs px-2 py-1 rounded ${
              data.patternSignal === 'buy'
                ? 'bg-emerald-900 text-emerald-300'
                : 'bg-red-900 text-red-300'
            }`}
          >
            {PATTERN_INFO[data.pattern as CandlestickPattern]?.name}
          </span>
        </div>
      )}
    </div>
  );
};

export function CandlestickChart({
  data,
  height = 400,
  showPatterns = true,
}: CandlestickChartProps) {
  const processedData = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Detect patterns
    const candles: Candle[] = data.map((d) => ({
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    const patternsDetected: Map<number, { pattern: CandlestickPattern; signal: 'buy' | 'sell' }> = new Map();

    if (showPatterns) {
      // Check each position for patterns
      for (let i = 2; i < candles.length; i++) {
        const subset = candles.slice(0, i + 1);
        const detected = detectPatterns(subset);
        if (detected.length > 0) {
          // Take the first (most significant) pattern
          patternsDetected.set(i, {
            pattern: detected[0].pattern,
            signal: detected[0].signal,
          });
        }
      }
    }

    return data.map((candle, index) => {
      const isBullish = candle.close >= candle.open;
      const patternInfo = patternsDetected.get(index);

      return {
        ...candle,
        bodyLow: Math.min(candle.open, candle.close),
        bodyHigh: Math.max(candle.open, candle.close),
        bodyHeight: Math.abs(candle.close - candle.open) || 0.01,
        wickHigh: candle.high,
        wickLow: candle.low,
        fill: isBullish ? BULLISH_COLOR : BEARISH_COLOR,
        stroke: isBullish ? BULLISH_COLOR : BEARISH_COLOR,
        pattern: patternInfo?.pattern,
        patternSignal: patternInfo?.signal,
      } as ProcessedCandle;
    });
  }, [data, showPatterns]);

  if (processedData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        No data available
      </div>
    );
  }

  // Calculate Y-axis domain
  const allHighs = processedData.map((d) => d.high);
  const allLows = processedData.map((d) => d.low);
  const minPrice = Math.min(...allLows);
  const maxPrice = Math.max(...allHighs);
  const padding = (maxPrice - minPrice) * 0.1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={processedData}
        margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis
          dataKey="date"
          stroke="#9ca3af"
          tick={{ fontSize: 10 }}
          interval="preserveStartEnd"
        />
        <YAxis
          stroke="#9ca3af"
          domain={[minPrice - padding, maxPrice + padding]}
          tick={{ fontSize: 10 }}
          tickFormatter={(value) => `$${value.toFixed(0)}`}
        />
        <Tooltip content={<CustomTooltip />} />

        {/* Candlestick bars */}
        <Bar
          dataKey="bodyHeight"
          shape={<CandlestickShape />}
          isAnimationActive={false}
        >
          {processedData.map((entry, index) => (
            <Cell
              key={`cell-${index}`}
              fill={entry.fill}
              stroke={entry.stroke}
            />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
