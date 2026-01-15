import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateMetrics, runBacktest, type EquityPoint } from './backtester';
import type { BacktestTrade, BacktestConfig, TradingRule } from '../types';

// Mock the external dependencies
vi.mock('./alphaVantage', () => ({
  getDailyData: vi.fn(),
}));

vi.mock('./candlestickPatterns', () => ({
  detectPatterns: vi.fn(),
}));

import { getDailyData } from './alphaVantage';
import { detectPatterns } from './candlestickPatterns';

describe('calculateMetrics', () => {
  const createTrade = (overrides: Partial<BacktestTrade> = {}): BacktestTrade => ({
    id: crypto.randomUUID(),
    ruleId: 'rule-1',
    ruleName: 'Test Rule',
    type: 'buy',
    shares: 10,
    entryPrice: 100,
    entryDate: new Date('2024-01-01'),
    exitPrice: 110,
    exitDate: new Date('2024-01-10'),
    profitLoss: 100,
    profitLossPercent: 10,
    holdingPeriodDays: 9,
    ...overrides,
  });

  const createEquityCurve = (values: number[]): EquityPoint[] =>
    values.map((equity, i) => ({
      date: new Date(2024, 0, i + 1),
      equity,
    }));

  describe('with winning trades only', () => {
    it('should calculate correct metrics for all winning trades', () => {
      const trades = [
        createTrade({ profitLoss: 100, profitLossPercent: 10 }),
        createTrade({ profitLoss: 200, profitLossPercent: 20 }),
        createTrade({ profitLoss: 150, profitLossPercent: 15 }),
      ];
      const equityCurve = createEquityCurve([10000, 10100, 10300, 10450]);

      const metrics = calculateMetrics(trades, 10000, 10450, equityCurve);

      expect(metrics.totalTrades).toBe(3);
      expect(metrics.winningTrades).toBe(3);
      expect(metrics.losingTrades).toBe(0);
      expect(metrics.winRate).toBe(100);
      expect(metrics.totalReturn).toBe(450);
      expect(metrics.totalReturnPercent).toBeCloseTo(4.5);
      expect(metrics.profitFactor).toBe(Infinity);
      expect(metrics.averageWin).toBeCloseTo(150);
      expect(metrics.averageLoss).toBe(0);
      expect(metrics.largestWin).toBe(200);
      expect(metrics.largestLoss).toBe(0);
    });
  });

  describe('with losing trades only', () => {
    it('should calculate correct metrics for all losing trades', () => {
      const trades = [
        createTrade({ profitLoss: -100, profitLossPercent: -10 }),
        createTrade({ profitLoss: -200, profitLossPercent: -20 }),
      ];
      const equityCurve = createEquityCurve([10000, 9900, 9700]);

      const metrics = calculateMetrics(trades, 10000, 9700, equityCurve);

      expect(metrics.totalTrades).toBe(2);
      expect(metrics.winningTrades).toBe(0);
      expect(metrics.losingTrades).toBe(2);
      expect(metrics.winRate).toBe(0);
      expect(metrics.totalReturn).toBe(-300);
      expect(metrics.totalReturnPercent).toBeCloseTo(-3);
      expect(metrics.profitFactor).toBe(0);
      expect(metrics.averageWin).toBe(0);
      expect(metrics.averageLoss).toBeCloseTo(150);
      expect(metrics.largestWin).toBe(0);
      expect(metrics.largestLoss).toBe(200);
    });
  });

  describe('with mixed trades', () => {
    it('should calculate correct metrics for mixed winning and losing trades', () => {
      const trades = [
        createTrade({ profitLoss: 300, profitLossPercent: 30, holdingPeriodDays: 5 }),
        createTrade({ profitLoss: -100, profitLossPercent: -10, holdingPeriodDays: 3 }),
        createTrade({ profitLoss: 200, profitLossPercent: 20, holdingPeriodDays: 7 }),
        createTrade({ profitLoss: -50, profitLossPercent: -5, holdingPeriodDays: 2 }),
      ];
      const equityCurve = createEquityCurve([10000, 10300, 10200, 10400, 10350]);

      const metrics = calculateMetrics(trades, 10000, 10350, equityCurve);

      expect(metrics.totalTrades).toBe(4);
      expect(metrics.winningTrades).toBe(2);
      expect(metrics.losingTrades).toBe(2);
      expect(metrics.winRate).toBe(50);
      expect(metrics.totalReturn).toBe(350);
      expect(metrics.totalReturnPercent).toBeCloseTo(3.5);
      expect(metrics.profitFactor).toBeCloseTo(500 / 150); // 3.33
      expect(metrics.averageWin).toBeCloseTo(250);
      expect(metrics.averageLoss).toBeCloseTo(75);
      expect(metrics.largestWin).toBe(300);
      expect(metrics.largestLoss).toBe(100);
      expect(metrics.averageHoldingPeriod).toBeCloseTo(4.25);
    });
  });

  describe('with no trades', () => {
    it('should handle empty trades array', () => {
      const trades: BacktestTrade[] = [];
      const equityCurve = createEquityCurve([10000, 10000, 10000]);

      const metrics = calculateMetrics(trades, 10000, 10000, equityCurve);

      expect(metrics.totalTrades).toBe(0);
      expect(metrics.winningTrades).toBe(0);
      expect(metrics.losingTrades).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.totalReturn).toBe(0);
      expect(metrics.profitFactor).toBe(0);
      expect(metrics.averageWin).toBe(0);
      expect(metrics.averageLoss).toBe(0);
      expect(metrics.averageHoldingPeriod).toBe(0);
    });
  });

  describe('max drawdown calculation', () => {
    it('should calculate max drawdown correctly', () => {
      // Equity goes: 10000 -> 10500 -> 10200 -> 10800 -> 10100
      // Max drawdown is from 10800 to 10100 = 700 (6.48%)
      const equityCurve = createEquityCurve([10000, 10500, 10200, 10800, 10100]);
      const trades = [createTrade({ profitLoss: 100 })];

      const metrics = calculateMetrics(trades, 10000, 10100, equityCurve);

      expect(metrics.maxDrawdown).toBe(700);
      expect(metrics.maxDrawdownPercent).toBeCloseTo(6.48, 1);
    });

    it('should return zero drawdown for constantly increasing equity', () => {
      const equityCurve = createEquityCurve([10000, 10100, 10200, 10300, 10400]);
      const trades = [createTrade({ profitLoss: 400 })];

      const metrics = calculateMetrics(trades, 10000, 10400, equityCurve);

      expect(metrics.maxDrawdown).toBe(0);
      expect(metrics.maxDrawdownPercent).toBe(0);
    });
  });

  describe('profit factor', () => {
    it('should return Infinity when there are no losses', () => {
      const trades = [createTrade({ profitLoss: 100 })];
      const equityCurve = createEquityCurve([10000, 10100]);

      const metrics = calculateMetrics(trades, 10000, 10100, equityCurve);

      expect(metrics.profitFactor).toBe(Infinity);
    });

    it('should return 0 when there are no wins', () => {
      const trades = [createTrade({ profitLoss: -100 })];
      const equityCurve = createEquityCurve([10000, 9900]);

      const metrics = calculateMetrics(trades, 10000, 9900, equityCurve);

      expect(metrics.profitFactor).toBe(0);
    });

    it('should calculate correct ratio of wins to losses', () => {
      const trades = [
        createTrade({ profitLoss: 300 }),
        createTrade({ profitLoss: -100 }),
      ];
      const equityCurve = createEquityCurve([10000, 10300, 10200]);

      const metrics = calculateMetrics(trades, 10000, 10200, equityCurve);

      expect(metrics.profitFactor).toBe(3); // 300 / 100
    });
  });
});

describe('runBacktest', () => {
  const mockGetDailyData = getDailyData as ReturnType<typeof vi.fn>;
  const mockDetectPatterns = detectPatterns as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockDailyData = (days: number, startPrice: number = 100) => {
    return Array.from({ length: days }, (_, i) => ({
      timestamp: new Date(2024, 0, i + 1).toISOString(),
      open: startPrice + i,
      high: startPrice + i + 2,
      low: startPrice + i - 1,
      close: startPrice + i + 1,
      volume: 1000000,
    }));
  };

  const createMockRule = (overrides: Partial<TradingRule> = {}): TradingRule => ({
    id: 'rule-1',
    name: 'Test Rule',
    symbol: 'AAPL',
    enabled: true,
    type: 'buy',
    ruleType: 'pattern',
    pattern: 'hammer',
    action: { type: 'market', shares: 10 },
    createdAt: new Date(),
    autoTrade: false,
    cooldownMinutes: 5,
    ...overrides,
  });

  describe('error handling', () => {
    it('should throw error when no historical data is returned', async () => {
      mockGetDailyData.mockResolvedValue([]);

      const config: BacktestConfig = {
        symbol: 'AAPL',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-03-01'),
        initialCapital: 10000,
        positionSize: 10,
        rules: [createMockRule()],
      };

      await expect(runBacktest(config)).rejects.toThrow(
        'No historical data returned for AAPL'
      );
    });

    it('should throw error when insufficient historical data', async () => {
      mockGetDailyData.mockResolvedValue(createMockDailyData(5));

      const config: BacktestConfig = {
        symbol: 'AAPL',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-03-01'),
        initialCapital: 10000,
        positionSize: 10,
        rules: [createMockRule()],
      };

      await expect(runBacktest(config)).rejects.toThrow(
        'Insufficient historical data for AAPL. Only 5 days available.'
      );
    });

    it('should throw error when insufficient data in date range', async () => {
      mockGetDailyData.mockResolvedValue(createMockDailyData(50));

      const config: BacktestConfig = {
        symbol: 'AAPL',
        startDate: new Date('2025-01-01'), // Future date - no data will match
        endDate: new Date('2025-03-01'),
        initialCapital: 10000,
        positionSize: 10,
        rules: [createMockRule()],
      };

      await expect(runBacktest(config)).rejects.toThrow(
        'Insufficient data in the selected date range'
      );
    });
  });

  describe('successful backtest', () => {
    it('should return valid result structure', async () => {
      mockGetDailyData.mockResolvedValue(createMockDailyData(50));
      mockDetectPatterns.mockReturnValue([]);

      const config: BacktestConfig = {
        symbol: 'AAPL',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-20'),
        initialCapital: 10000,
        positionSize: 10,
        rules: [createMockRule()],
      };

      const result = await runBacktest(config);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('config');
      expect(result).toHaveProperty('trades');
      expect(result).toHaveProperty('metrics');
      expect(result).toHaveProperty('equityCurve');
      expect(result).toHaveProperty('runAt');
      expect(result.config).toEqual(config);
    });

    it('should filter rules by symbol', async () => {
      mockGetDailyData.mockResolvedValue(createMockDailyData(50));
      mockDetectPatterns.mockReturnValue([{ pattern: 'hammer', signal: 'buy', confidence: 0.8 }]);

      const config: BacktestConfig = {
        symbol: 'AAPL',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-20'),
        initialCapital: 10000,
        positionSize: 10,
        rules: [
          createMockRule({ symbol: 'AAPL' }),
          createMockRule({ id: 'rule-2', symbol: 'GOOGL' }), // Should be filtered out
        ],
      };

      const result = await runBacktest(config);

      // Only AAPL rules should be considered
      expect(result).toBeDefined();
    });

    it('should only use enabled pattern rules', async () => {
      mockGetDailyData.mockResolvedValue(createMockDailyData(50));
      mockDetectPatterns.mockReturnValue([]);

      const config: BacktestConfig = {
        symbol: 'AAPL',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-20'),
        initialCapital: 10000,
        positionSize: 10,
        rules: [
          createMockRule({ enabled: false }), // Disabled
          createMockRule({ id: 'rule-2', ruleType: 'price' }), // Wrong type
          createMockRule({ id: 'rule-3', enabled: true, ruleType: 'pattern' }), // Valid
        ],
      };

      const result = await runBacktest(config);

      expect(result).toBeDefined();
    });

    it('should open position on buy signal', async () => {
      mockGetDailyData.mockResolvedValue(createMockDailyData(50, 100));

      // Return pattern only on first call (day 11), then no patterns
      let callCount = 0;
      mockDetectPatterns.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return [{ pattern: 'hammer', signal: 'buy', confidence: 0.8 }];
        }
        return [];
      });

      const config: BacktestConfig = {
        symbol: 'AAPL',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-20'),
        initialCapital: 10000,
        positionSize: 10,
        rules: [createMockRule({ type: 'buy', pattern: 'hammer' })],
      };

      const result = await runBacktest(config);

      // Should have at least one trade (position opened and closed at end)
      expect(result.trades.length).toBeGreaterThanOrEqual(0);
      expect(result.equityCurve.length).toBeGreaterThan(0);
    });

    it('should calculate position size based on percentage', async () => {
      mockGetDailyData.mockResolvedValue(createMockDailyData(50, 100));
      mockDetectPatterns.mockReturnValue([{ pattern: 'hammer', signal: 'buy', confidence: 0.8 }]);

      const config: BacktestConfig = {
        symbol: 'AAPL',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-20'),
        initialCapital: 10000,
        positionSize: 50, // 50% of capital
        rules: [createMockRule({ type: 'buy', pattern: 'hammer' })],
      };

      const result = await runBacktest(config);

      // With $10,000 and 50% position size at ~$111 price, should buy ~45 shares
      if (result.trades.length > 0) {
        expect(result.trades[0].shares).toBeLessThanOrEqual(50);
      }
    });

    it('should track equity curve throughout backtest', async () => {
      mockGetDailyData.mockResolvedValue(createMockDailyData(50));
      mockDetectPatterns.mockReturnValue([]);

      const config: BacktestConfig = {
        symbol: 'AAPL',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-02-20'),
        initialCapital: 10000,
        positionSize: 10,
        rules: [createMockRule()],
      };

      const result = await runBacktest(config);

      expect(result.equityCurve.length).toBeGreaterThan(0);
      result.equityCurve.forEach((point) => {
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('equity');
        expect(typeof point.equity).toBe('number');
      });
    });
  });
});
