import { describe, it, expect } from 'vitest';
import {
  type Candle,
  isHammer,
  isInvertedHammer,
  isShootingStar,
  isGravestoneDoji,
  isBullishEngulfing,
  isBearishEngulfing,
  isEveningStar,
  isBullishBreakout,
  isBearishBreakout,
  detectPatterns,
  PATTERN_INFO,
} from './candlestickPatterns';

describe('candlestickPatterns', () => {
  describe('isHammer', () => {
    it('should detect a valid hammer pattern', () => {
      // Hammer: small body at top, long lower shadow (>= 2x body), little upper shadow (<= 0.5x body)
      // body <= 35% of range. Using: body=1, lower=10, upper=0.1
      const hammer: Candle = {
        open: 99,
        high: 100.1, // upper = 0.1
        low: 89,
        close: 100, // body = 1, lower = 10
      };
      expect(isHammer(hammer)).toBe(true);
    });

    it('should reject candle with short lower shadow', () => {
      const notHammer: Candle = {
        open: 100,
        high: 105,
        low: 98,
        close: 102,
      };
      expect(isHammer(notHammer)).toBe(false);
    });

    it('should reject candle with long upper shadow', () => {
      const notHammer: Candle = {
        open: 100,
        high: 110,
        low: 95,
        close: 101,
      };
      expect(isHammer(notHammer)).toBe(false);
    });

    it('should reject candle with zero range', () => {
      const flatCandle: Candle = {
        open: 100,
        high: 100,
        low: 100,
        close: 100,
      };
      expect(isHammer(flatCandle)).toBe(false);
    });

    it('should detect bearish hammer (hanging man shape)', () => {
      const bearishHammer: Candle = {
        open: 101,
        high: 101.5,
        low: 90,
        close: 100,
      };
      expect(isHammer(bearishHammer)).toBe(true);
    });
  });

  describe('isInvertedHammer', () => {
    it('should detect a valid inverted hammer pattern', () => {
      // Inverted Hammer: small body at bottom, long upper shadow (>=2x body), little lower shadow (<=0.5x body)
      // body <= 35% of range
      const invertedHammer: Candle = {
        open: 100,
        high: 111, // upper = 10
        low: 99.9, // lower = 0.1
        close: 101, // body = 1
      };
      expect(isInvertedHammer(invertedHammer)).toBe(true);
    });

    it('should reject candle with short upper shadow', () => {
      const notInverted: Candle = {
        open: 100,
        high: 102,
        low: 95,
        close: 101,
      };
      expect(isInvertedHammer(notInverted)).toBe(false);
    });

    it('should reject candle with long lower shadow', () => {
      const notInverted: Candle = {
        open: 100,
        high: 108,
        low: 90,
        close: 101,
      };
      expect(isInvertedHammer(notInverted)).toBe(false);
    });
  });

  describe('isShootingStar', () => {
    it('should detect shooting star after bullish candle', () => {
      const prevBullish: Candle = {
        open: 95,
        high: 100,
        low: 94,
        close: 99,
      };
      // Shooting star has inverted hammer shape: long upper shadow, small body, small lower shadow
      const shootingStar: Candle = {
        open: 100,
        high: 111, // upper = 10
        low: 99.9, // lower = 0.1
        close: 101, // body = 1
      };
      expect(isShootingStar(shootingStar, prevBullish)).toBe(true);
    });

    it('should detect shooting star when opening above previous close', () => {
      const prevCandle: Candle = {
        open: 100,
        high: 102,
        low: 98,
        close: 95,
      };
      const shootingStar: Candle = {
        open: 100, // Opens above prev close (95)
        high: 111,
        low: 99.9,
        close: 101,
      };
      expect(isShootingStar(shootingStar, prevCandle)).toBe(true);
    });

    it('should return true for shooting star shape without previous candle', () => {
      const shootingStar: Candle = {
        open: 100,
        high: 111,
        low: 99.9,
        close: 101,
      };
      expect(isShootingStar(shootingStar)).toBe(true);
    });

    it('should reject non-inverted-hammer shape', () => {
      const notShootingStar: Candle = {
        open: 100,
        high: 102,
        low: 90,
        close: 101,
      };
      expect(isShootingStar(notShootingStar)).toBe(false);
    });
  });

  describe('isGravestoneDoji', () => {
    it('should detect a valid gravestone doji', () => {
      // Gravestone Doji: open and close at low, long upper shadow
      const gravestone: Candle = {
        open: 100,
        high: 110,
        low: 100,
        close: 100.5,
      };
      expect(isGravestoneDoji(gravestone)).toBe(true);
    });

    it('should reject candle with large body', () => {
      const notGravestone: Candle = {
        open: 100,
        high: 110,
        low: 100,
        close: 105,
      };
      expect(isGravestoneDoji(notGravestone)).toBe(false);
    });

    it('should reject candle with long lower shadow', () => {
      const notGravestone: Candle = {
        open: 100,
        high: 105,
        low: 90,
        close: 100.5,
      };
      expect(isGravestoneDoji(notGravestone)).toBe(false);
    });

    it('should reject candle with short upper shadow', () => {
      const notGravestone: Candle = {
        open: 100,
        high: 101,
        low: 100,
        close: 100.5,
      };
      expect(isGravestoneDoji(notGravestone)).toBe(false);
    });
  });

  describe('isBullishEngulfing', () => {
    it('should detect valid bullish engulfing pattern', () => {
      const bearish: Candle = {
        open: 105,
        high: 106,
        low: 100,
        close: 101,
      };
      const bullish: Candle = {
        open: 100,
        high: 108,
        low: 99,
        close: 107,
      };
      expect(isBullishEngulfing(bullish, bearish)).toBe(true);
    });

    it('should reject when previous candle is bullish', () => {
      const prevBullish: Candle = {
        open: 100,
        high: 106,
        low: 99,
        close: 105,
      };
      const current: Candle = {
        open: 104,
        high: 110,
        low: 103,
        close: 109,
      };
      expect(isBullishEngulfing(current, prevBullish)).toBe(false);
    });

    it('should reject when current candle is bearish', () => {
      const bearish: Candle = {
        open: 105,
        high: 106,
        low: 100,
        close: 101,
      };
      const currentBearish: Candle = {
        open: 107,
        high: 108,
        low: 99,
        close: 100,
      };
      expect(isBullishEngulfing(currentBearish, bearish)).toBe(false);
    });

    it('should reject when current body is smaller', () => {
      const bearish: Candle = {
        open: 110,
        high: 111,
        low: 100,
        close: 101,
      };
      const smallBullish: Candle = {
        open: 100,
        high: 104,
        low: 99,
        close: 103,
      };
      expect(isBullishEngulfing(smallBullish, bearish)).toBe(false);
    });
  });

  describe('isBearishEngulfing', () => {
    it('should detect valid bearish engulfing pattern', () => {
      const bullish: Candle = {
        open: 100,
        high: 106,
        low: 99,
        close: 105,
      };
      const bearish: Candle = {
        open: 106,
        high: 107,
        low: 98,
        close: 99,
      };
      expect(isBearishEngulfing(bearish, bullish)).toBe(true);
    });

    it('should reject when previous candle is bearish', () => {
      const prevBearish: Candle = {
        open: 105,
        high: 106,
        low: 99,
        close: 100,
      };
      const current: Candle = {
        open: 102,
        high: 103,
        low: 95,
        close: 96,
      };
      expect(isBearishEngulfing(current, prevBearish)).toBe(false);
    });

    it('should reject when current candle is bullish', () => {
      const bullish: Candle = {
        open: 100,
        high: 106,
        low: 99,
        close: 105,
      };
      const currentBullish: Candle = {
        open: 103,
        high: 110,
        low: 102,
        close: 108,
      };
      expect(isBearishEngulfing(currentBullish, bullish)).toBe(false);
    });
  });

  describe('isEveningStar', () => {
    it('should detect valid evening star pattern', () => {
      // First: large bullish candle (body = 10)
      const first: Candle = {
        open: 100,
        high: 111,
        low: 99,
        close: 110,
      };
      // Middle: small body/doji that gaps up from first close
      // middleBody < range * 0.3, and middle.low > first.close (110)
      const middle: Candle = {
        open: 111.5,
        high: 113,
        low: 111, // > first.close (110) - gaps up
        close: 112, // body = 0.5, range = 2, 0.5 < 0.6 ✓
      };
      // Current: large bearish that closes below midpoint of first ((100+110)/2 = 105)
      // currentBody > middleBody * 2
      const current: Candle = {
        open: 111,
        high: 112,
        low: 102,
        close: 104, // body = 7 > 1 ✓, closes at 104 < 105 ✓
      };
      expect(isEveningStar(current, middle, first)).toBe(true);
    });

    it('should reject when first candle is bearish', () => {
      const first: Candle = {
        open: 110,
        high: 111,
        low: 99,
        close: 100,
      };
      const middle: Candle = {
        open: 102,
        high: 104,
        low: 101,
        close: 103,
      };
      const current: Candle = {
        open: 102,
        high: 103,
        low: 95,
        close: 96,
      };
      expect(isEveningStar(current, middle, first)).toBe(false);
    });

    it('should reject when middle has large body', () => {
      const first: Candle = {
        open: 100,
        high: 111,
        low: 99,
        close: 110,
      };
      const middle: Candle = {
        open: 111,
        high: 120,
        low: 110,
        close: 119,
      };
      const current: Candle = {
        open: 118,
        high: 119,
        low: 102,
        close: 103,
      };
      expect(isEveningStar(current, middle, first)).toBe(false);
    });

    it('should reject when current is bullish', () => {
      const first: Candle = {
        open: 100,
        high: 111,
        low: 99,
        close: 110,
      };
      const middle: Candle = {
        open: 112,
        high: 114,
        low: 111,
        close: 113,
      };
      const current: Candle = {
        open: 112,
        high: 120,
        low: 111,
        close: 118,
      };
      expect(isEveningStar(current, middle, first)).toBe(false);
    });
  });

  describe('isBullishBreakout', () => {
    it('should detect bullish breakout above recent highs', () => {
      const candles: Candle[] = [];
      // Create 10 candles with highs around 100
      for (let i = 0; i < 10; i++) {
        candles.push({
          open: 95 + i * 0.2,
          high: 100,
          low: 94 + i * 0.2,
          close: 96 + i * 0.2,
        });
      }
      // Add breakout candle that closes above 100
      candles.push({
        open: 99,
        high: 105,
        low: 98,
        close: 104, // Above highest high (100) and strong move
      });
      expect(isBullishBreakout(candles)).toBe(true);
    });

    it('should reject when close is below recent highs', () => {
      const candles: Candle[] = [];
      for (let i = 0; i < 10; i++) {
        candles.push({
          open: 95,
          high: 100,
          low: 94,
          close: 96,
        });
      }
      candles.push({
        open: 95,
        high: 99,
        low: 94,
        close: 98, // Below highest high
      });
      expect(isBullishBreakout(candles)).toBe(false);
    });

    it('should reject bearish breakout candle', () => {
      const candles: Candle[] = [];
      for (let i = 0; i < 10; i++) {
        candles.push({
          open: 95,
          high: 100,
          low: 94,
          close: 96,
        });
      }
      candles.push({
        open: 105,
        high: 106,
        low: 100,
        close: 101, // Close > high but bearish candle
      });
      expect(isBullishBreakout(candles)).toBe(false);
    });

    it('should return false when not enough candles', () => {
      const candles: Candle[] = [
        { open: 100, high: 105, low: 99, close: 104 },
      ];
      expect(isBullishBreakout(candles)).toBe(false);
    });
  });

  describe('isBearishBreakout', () => {
    it('should detect bearish breakout below recent lows', () => {
      const candles: Candle[] = [];
      // Create 10 candles with lows around 100
      for (let i = 0; i < 10; i++) {
        candles.push({
          open: 105,
          high: 106,
          low: 100,
          close: 104,
        });
      }
      // Add breakout candle that closes below 100
      candles.push({
        open: 101,
        high: 102,
        low: 95,
        close: 96, // Below lowest low (100) and strong move
      });
      expect(isBearishBreakout(candles)).toBe(true);
    });

    it('should reject when close is above recent lows', () => {
      const candles: Candle[] = [];
      for (let i = 0; i < 10; i++) {
        candles.push({
          open: 105,
          high: 106,
          low: 100,
          close: 104,
        });
      }
      candles.push({
        open: 103,
        high: 104,
        low: 101,
        close: 102, // Above lowest low
      });
      expect(isBearishBreakout(candles)).toBe(false);
    });

    it('should reject bullish breakout candle', () => {
      const candles: Candle[] = [];
      for (let i = 0; i < 10; i++) {
        candles.push({
          open: 105,
          high: 106,
          low: 100,
          close: 104,
        });
      }
      candles.push({
        open: 97,
        high: 100,
        low: 95,
        close: 99, // Close < low but bullish candle
      });
      expect(isBearishBreakout(candles)).toBe(false);
    });
  });

  describe('detectPatterns', () => {
    it('should return empty array for empty candles', () => {
      expect(detectPatterns([])).toEqual([]);
    });

    it('should detect hammer pattern', () => {
      const candles: Candle[] = [
        { open: 99, high: 100.1, low: 89, close: 100 }, // Valid hammer
      ];
      const results = detectPatterns(candles);
      expect(results.some((r) => r.pattern === 'hammer')).toBe(true);
    });

    it('should detect multiple patterns when applicable', () => {
      // Create candles that form bullish engulfing
      const candles: Candle[] = [
        { open: 105, high: 106, low: 100, close: 101 }, // Bearish
        { open: 100, high: 108, low: 99, close: 107 }, // Bullish engulfing
      ];
      const results = detectPatterns(candles);
      expect(results.some((r) => r.pattern === 'bullish_engulfing')).toBe(true);
    });

    it('should include correct signal and confidence', () => {
      const candles: Candle[] = [
        { open: 99, high: 100.1, low: 89, close: 100 }, // Valid hammer
      ];
      const results = detectPatterns(candles);
      const hammer = results.find((r) => r.pattern === 'hammer');
      expect(hammer?.signal).toBe('buy');
      expect(hammer?.confidence).toBe(70);
    });

    it('should detect gravestone doji with correct confidence', () => {
      const candles: Candle[] = [
        { open: 100, high: 110, low: 100, close: 100.5 },
      ];
      const results = detectPatterns(candles);
      const gravestone = results.find((r) => r.pattern === 'gravestone_doji');
      expect(gravestone?.signal).toBe('sell');
      expect(gravestone?.confidence).toBe(75);
    });
  });

  describe('PATTERN_INFO', () => {
    it('should have info for all pattern types', () => {
      const patterns = [
        'hammer',
        'inverted_hammer',
        'bullish_engulfing',
        'bearish_engulfing',
        'shooting_star',
        'evening_star',
        'gravestone_doji',
        'bullish_breakout',
        'bearish_breakout',
      ];
      patterns.forEach((pattern) => {
        expect(PATTERN_INFO[pattern as keyof typeof PATTERN_INFO]).toBeDefined();
      });
    });

    it('should have correct signals for buy patterns', () => {
      expect(PATTERN_INFO.hammer.signal).toBe('buy');
      expect(PATTERN_INFO.inverted_hammer.signal).toBe('buy');
      expect(PATTERN_INFO.bullish_engulfing.signal).toBe('buy');
      expect(PATTERN_INFO.bullish_breakout.signal).toBe('buy');
    });

    it('should have correct signals for sell patterns', () => {
      expect(PATTERN_INFO.bearish_engulfing.signal).toBe('sell');
      expect(PATTERN_INFO.shooting_star.signal).toBe('sell');
      expect(PATTERN_INFO.evening_star.signal).toBe('sell');
      expect(PATTERN_INFO.gravestone_doji.signal).toBe('sell');
      expect(PATTERN_INFO.bearish_breakout.signal).toBe('sell');
    });

    it('should have name and description for all patterns', () => {
      Object.values(PATTERN_INFO).forEach((info) => {
        expect(info.name).toBeTruthy();
        expect(info.description).toBeTruthy();
      });
    });
  });
});
