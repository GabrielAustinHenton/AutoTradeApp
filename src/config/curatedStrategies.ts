import type { TradingRule } from '../types';

export interface CuratedStrategy extends TradingRule {
  description: string;
}

/**
 * Pre-built trading strategies with documented real-world efficacy.
 * These are the strategies tested in backtesting — users cannot add or remove them.
 * All are symbol-agnostic (no symbol field) so they apply to any stock.
 */
export const CURATED_STRATEGIES: CuratedStrategy[] = [
  {
    id: 'curated-hammer',
    name: 'Hammer Reversal',
    description:
      "Bottom reversal candle where sellers pushed price down but buyers recovered by close. " +
      "Thomas Bulkowski documented 60%+ success in downtrends. Best with oversold RSI and volume spike.",
    enabled: true,
    type: 'buy',
    ruleType: 'pattern',
    pattern: 'hammer',
    action: { type: 'market' },
    createdAt: new Date('2025-01-01'),
    autoTrade: true,
    cooldownMinutes: 5,
    takeProfitPercent: 5,
    stopLossPercent: 2,
    minConfidence: 65,
    rsiFilter: { enabled: true, maxRSI: 40 },
    volumeFilter: { enabled: true, minMultiplier: 1.5 },
  },
  {
    id: 'curated-bullish-engulfing',
    name: 'Bullish Engulfing',
    description:
      "Two-candle pattern where a large bull candle completely engulfs the prior bear candle. " +
      "Steve Nison popularized this; widely regarded as one of the most reliable reversal signals at support.",
    enabled: true,
    type: 'buy',
    ruleType: 'pattern',
    pattern: 'bullish_engulfing',
    action: { type: 'market' },
    createdAt: new Date('2025-01-01'),
    autoTrade: true,
    cooldownMinutes: 5,
    takeProfitPercent: 5,
    stopLossPercent: 2,
    minConfidence: 65,
    rsiFilter: { enabled: true, maxRSI: 50 },
    volumeFilter: { enabled: true, minMultiplier: 1.5 },
  },
  {
    id: 'curated-inverted-hammer',
    name: 'Inverted Hammer',
    description:
      "Price tested higher intraday but closed near the open, signaling failed bearish momentum. " +
      "Common setup for bottom reversals — traders look for confirmation the following day.",
    enabled: true,
    type: 'buy',
    ruleType: 'pattern',
    pattern: 'inverted_hammer',
    action: { type: 'market' },
    createdAt: new Date('2025-01-01'),
    autoTrade: true,
    cooldownMinutes: 5,
    takeProfitPercent: 4,
    stopLossPercent: 2,
    minConfidence: 60,
    rsiFilter: { enabled: true, maxRSI: 45 },
    volumeFilter: { enabled: true, minMultiplier: 1.3 },
  },
  {
    id: 'curated-volume-breakout',
    name: 'Volume Breakout',
    description:
      "Price breaks above prior resistance on 2x+ average volume — a high-conviction momentum signal. " +
      "Core of William O'Neil's CANSLIM system and Nicolas Darvas box theory. Works best in uptrending markets.",
    enabled: true,
    type: 'buy',
    ruleType: 'pattern',
    pattern: 'bullish_breakout',
    action: { type: 'market' },
    createdAt: new Date('2025-01-01'),
    autoTrade: true,
    cooldownMinutes: 5,
    takeProfitPercent: 5,
    stopLossPercent: 2,
    minConfidence: 65,
    rsiFilter: { enabled: true, maxRSI: 60 },
    volumeFilter: { enabled: true, minMultiplier: 2.0 },
  },
  {
    id: 'curated-breakout-pullback',
    name: 'Breakout Pullback',
    description:
      "Bullish breakout that occurred after a shallow pullback — lower risk entry than chasing the initial breakout. " +
      "Mark Minervini's VCP (Volatility Contraction Pattern) is built on this concept.",
    enabled: true,
    type: 'buy',
    ruleType: 'pattern',
    pattern: 'bullish_breakout',
    action: { type: 'market' },
    createdAt: new Date('2025-01-01'),
    autoTrade: true,
    cooldownMinutes: 5,
    takeProfitPercent: 6,
    stopLossPercent: 3,
    minConfidence: 70,
    rsiFilter: { enabled: true, maxRSI: 55 },
    volumeFilter: { enabled: true, minMultiplier: 1.5 },
  },
];
