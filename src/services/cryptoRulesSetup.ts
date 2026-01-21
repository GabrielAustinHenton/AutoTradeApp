import { useStore } from '../store/useStore';
import type { TradingRule, CandlestickPattern } from '../types';

/**
 * Crypto Trading Rules Setup
 * Creates auto-trading rules for cryptocurrencies with take-profit and stop-loss
 */

// Crypto symbols to create rules for
const CRYPTO_SYMBOLS = ['ETH', 'BTC', 'SOL'];

// Bullish patterns for buy signals
const BULLISH_PATTERNS: CandlestickPattern[] = [
  'hammer',
  'bullish_engulfing',
  'inverted_hammer',
  'bullish_breakout',
];

// Bearish patterns for sell signals
const BEARISH_PATTERNS: CandlestickPattern[] = [
  'shooting_star',
  'bearish_engulfing',
  'evening_star',
];

interface CryptoRuleConfig {
  takeProfitPercent: number;
  stopLossPercent: number;
  trailingStopPercent: number;
  shares: number;
  cooldownMinutes: number;
}

const DEFAULT_CONFIG: CryptoRuleConfig = {
  takeProfitPercent: 10,   // Sell when up 10% (higher to let winners run)
  stopLossPercent: 3,      // Sell when down 3%
  trailingStopPercent: 5,  // Trail 5% below highest price
  shares: 1,               // Trade 1 unit of crypto
  cooldownMinutes: 15,     // 15 min cooldown between trades
};

/**
 * Create a crypto buy rule with take-profit and stop-loss
 */
function createCryptoRule(
  symbol: string,
  pattern: CandlestickPattern,
  config: CryptoRuleConfig = DEFAULT_CONFIG
): TradingRule {
  const patternNames: Record<CandlestickPattern, string> = {
    hammer: 'Hammer',
    inverted_hammer: 'Inverted Hammer',
    bullish_engulfing: 'Bullish Engulfing',
    bearish_engulfing: 'Bearish Engulfing',
    shooting_star: 'Shooting Star',
    evening_star: 'Evening Star',
    gravestone_doji: 'Gravestone Doji',
    bullish_breakout: 'Bullish Breakout',
    bearish_breakout: 'Bearish Breakout',
  };

  return {
    id: `crypto-${symbol}-${pattern}-${Date.now()}`,
    name: `${symbol} ${patternNames[pattern]} Auto-Buy`,
    symbol,
    enabled: true,
    type: 'buy',
    ruleType: 'pattern',
    pattern,
    action: {
      type: 'market',
      shares: config.shares,
    },
    createdAt: new Date(),
    autoTrade: true,
    cooldownMinutes: config.cooldownMinutes,
    takeProfitPercent: config.takeProfitPercent,
    stopLossPercent: config.stopLossPercent,
    trailingStopPercent: config.trailingStopPercent,
  };
}

/**
 * Create a crypto sell rule for bearish patterns
 */
function createCryptoSellRule(
  symbol: string,
  pattern: CandlestickPattern,
  config: CryptoRuleConfig = DEFAULT_CONFIG
): TradingRule {
  const patternNames: Record<CandlestickPattern, string> = {
    hammer: 'Hammer',
    inverted_hammer: 'Inverted Hammer',
    bullish_engulfing: 'Bullish Engulfing',
    bearish_engulfing: 'Bearish Engulfing',
    shooting_star: 'Shooting Star',
    evening_star: 'Evening Star',
    gravestone_doji: 'Gravestone Doji',
    bullish_breakout: 'Bullish Breakout',
    bearish_breakout: 'Bearish Breakout',
  };

  return {
    id: `crypto-sell-${symbol}-${pattern}-${Date.now()}`,
    name: `${symbol} ${patternNames[pattern]} Auto-Sell`,
    symbol,
    enabled: true,
    type: 'sell',
    ruleType: 'pattern',
    pattern,
    action: {
      type: 'market',
      percentOfPortfolio: 100,
    },
    createdAt: new Date(),
    autoTrade: true,
    cooldownMinutes: config.cooldownMinutes,
  };
}

/**
 * Set up crypto trading rules for all supported crypto symbols
 * Creates buy rules for bullish patterns with auto take-profit/stop-loss
 * Creates sell rules for bearish patterns
 */
export function setupCryptoRules(config: Partial<CryptoRuleConfig> = {}): TradingRule[] {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const rules: TradingRule[] = [];

  for (const symbol of CRYPTO_SYMBOLS) {
    // Buy rules for bullish patterns
    for (const pattern of BULLISH_PATTERNS) {
      rules.push(createCryptoRule(symbol, pattern, finalConfig));
    }
    // Sell rules for bearish patterns
    for (const pattern of BEARISH_PATTERNS) {
      rules.push(createCryptoSellRule(symbol, pattern, finalConfig));
    }
  }

  return rules;
}

/**
 * Add crypto rules to the store
 */
export function addCryptoRulesToStore(config: Partial<CryptoRuleConfig> = {}): void {
  const store = useStore.getState();
  const rules = setupCryptoRules(config);

  // Check for existing crypto rules to avoid duplicates
  const existingSymbols = new Set(
    store.tradingRules
      .filter((r) => CRYPTO_SYMBOLS.includes(r.symbol) && r.autoTrade)
      .map((r) => `${r.symbol}-${r.pattern}`)
  );

  for (const rule of rules) {
    const key = `${rule.symbol}-${rule.pattern}`;
    if (!existingSymbols.has(key)) {
      store.addTradingRule(rule);
    }
  }
}

/**
 * Remove all crypto trading rules
 */
export function removeCryptoRules(): void {
  const store = useStore.getState();
  const cryptoRuleIds = store.tradingRules
    .filter((r) => CRYPTO_SYMBOLS.includes(r.symbol))
    .map((r) => r.id);

  for (const id of cryptoRuleIds) {
    store.removeTradingRule(id);
  }
}

/**
 * Enable auto-trading for paper mode
 */
export function enablePaperAutoTrading(): void {
  const store = useStore.getState();

  // Set trading mode to paper
  store.setTradingMode('paper');

  // Enable auto-trading with reasonable defaults
  store.updateAutoTradeConfig({
    enabled: true,
    maxTradesPerDay: 20,
    maxPositionSize: 10,
    tradingHoursOnly: false, // Crypto trades 24/7
  });
}

/**
 * Quick setup: Enable paper auto-trading and add crypto rules
 */
export function quickSetupCryptoTrading(config: Partial<CryptoRuleConfig> = {}): void {
  enablePaperAutoTrading();
  addCryptoRulesToStore(config);
}
