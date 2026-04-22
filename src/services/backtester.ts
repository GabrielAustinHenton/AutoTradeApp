import { alpaca } from './alpaca';
import { getHistoricalData, getSymbolsForYear } from '../data/historical2008';

/**
 * OPENING RANGE BREAKOUT (ORB) DAY TRADING SYSTEM
 * Based on proven strategy with 74% win rate
 * Source: https://tradethatswing.com/opening-range-breakout-strategy
 *
 * Rules:
 * 1. Look for stocks breaking above yesterday's high (breakout)
 * 2. Enter when today's price exceeds yesterday's high
 * 3. Profit target: 1.5% (half the typical daily range)
 * 4. Stop loss: 0.75% (tight risk management)
 * 5. Risk/Reward: 2:1
 * 6. Position size: 10% of capital (more aggressive)
 * 7. Take up to 3 trades per day across different stocks
 * 8. Exit by close - ALWAYS in cash overnight
 */

interface DayTradeSetup {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  prevClose: number;
  gapPercent: number;      // How much it gapped from prev close
  dayRange: number;        // (high - low) / open as %
  score: number;           // Overall setup quality
}

// Realistic trading constraints
export const TRADING_CONSTRAINTS = {
  PDT_MINIMUM: 25000,           // Pattern Day Trader minimum (regulatory requirement)
  FULL_POSITION_LIMIT: 100000,  // Full 25% position size up to this
  GOAL_AMOUNT: 500000,          // Stop day trading at this amount
  MIN_POSITION_PERCENT: 5,      // Minimum position size at goal
};

// Historical stocks for backtesting years before 2010
// Only includes stocks that were publicly traded and liquid in 2008
export const HISTORICAL_STOCKS_PRE_2010 = [
  // Tech (existed pre-2008)
  'AAPL',   // 1980
  'MSFT',   // 1986
  'INTC',   // 1971
  'ORCL',   // 1986
  'CSCO',   // 1990
  'IBM',    // 1911
  'HPQ',    // 1957 (HP)
  'DELL',   // 1988
  // Financials
  'JPM',    // 1969
  'BAC',    // 1998
  'GS',     // 1999
  'WFC',    // 1852
  'C',      // 1998 (Citigroup)
  // Healthcare
  'JNJ',    // 1944
  'PFE',    // 1942
  'MRK',    // 1891
  'ABT',    // 1929
  // Consumer
  'KO',     // 1919
  'PEP',    // 1919
  'WMT',    // 1972
  'HD',     // 1981
  'MCD',    // 1965
  'NKE',    // 1980
  'PG',     // 1837
  // Energy
  'XOM',    // 1920s
  'CVX',    // 1926
  // Industrial
  'GE',     // 1892
  'CAT',    // 1929
  'MMM',    // 1946
  'BA',     // 1934
  // Entertainment
  'DIS',    // 1957
];

// Volatility-based slippage multipliers (simulates VIX effect)
// Higher market volatility = wider spreads = more slippage
// CAPPED to prevent unrealistic cost destruction
const VOLATILITY_SLIPPAGE_TIERS = [
  { maxVolatility: 1.5, multiplier: 1.0 },   // Normal: VIX ~12-20
  { maxVolatility: 2.5, multiplier: 1.5 },   // Elevated: VIX ~20-30
  { maxVolatility: 4.0, multiplier: 2.0 },   // High: VIX ~30-50
  { maxVolatility: 6.0, multiplier: 3.0 },   // Panic: VIX ~50-80 (2008, COVID)
  { maxVolatility: Infinity, multiplier: 4.0 }, // Extreme: capped at 4x
];

// Calculate market volatility from recent price data (VIX proxy)
// Returns a multiplier: 1.0 = normal, 2.0+ = elevated, 5.0+ = panic
function calculateMarketVolatility(
  allData: Map<string, any[]>,
  currentDate: string,
  lookbackDays: number = 20
): number {
  let totalVolatility = 0;
  let stockCount = 0;

  allData.forEach((data) => {
    // Find current date index
    const currentIndex = data.findIndex(d => d.timestamp === currentDate);
    if (currentIndex < lookbackDays) return;

    // Calculate average daily range over lookback period
    let sumDailyRange = 0;
    for (let i = currentIndex - lookbackDays; i < currentIndex; i++) {
      const dayRange = (data[i].high - data[i].low) / data[i].close;
      sumDailyRange += dayRange;
    }
    const avgDailyRange = sumDailyRange / lookbackDays;

    // Normal daily range is about 1-2% for most stocks
    // Normalize so 1.5% average range = 1.0 volatility
    const normalizedVolatility = avgDailyRange / 0.015;
    totalVolatility += normalizedVolatility;
    stockCount++;
  });

  if (stockCount === 0) return 1.0;

  const avgVolatility = totalVolatility / stockCount;

  // Find the appropriate slippage multiplier
  for (const tier of VOLATILITY_SLIPPAGE_TIERS) {
    if (avgVolatility <= tier.maxVolatility) {
      return tier.multiplier;
    }
  }

  return 10.0; // Extreme volatility
}

export interface DayTradeResult {
  initialCapital: number;
  finalCapital: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalReturnPercent: number;
  avgWinPercent: number;
  avgLossPercent: number;
  bestDay: number;
  worstDay: number;
  totalCosts: number;  // Total transaction costs paid
  // Drawdown protection info
  drawdownStopTriggered: boolean;
  drawdownStopDate: string | null;
  tradesSkippedDueToDrawdown: number;
  // Goal reached info
  goalReached: boolean;
  goalReachedDate: string | null;
  goalReachedCapital: number | null;
  // Realistic estimate (with haircut applied)
  realisticReturnPercent: number;
  realisticFinalCapital: number;
  haircutPercent: number;
  haircutReasons: string[];
  trades: {
    date: string;
    symbol: string;
    entry: number;
    exit: number;
    pnlPercent: number;
    pnlDollars: number;
    outcome: 'WIN' | 'LOSS' | 'SCRATCH';
  }[];
  equityCurve: { date: string; equity: number }[];
}

export async function runDayTradingBacktest(
  symbols: string[],
  initialCapital: number = 1000,
  positionSizePercent: number = 25,  // 25% of capital per trade - AGGRESSIVE
  profitTargetPercent: number = 2.0, // Take profit at 2%
  stopLossPercent: number = 1.0,     // Stop loss at 1% (2:1 R/R)
  yearsBack: number = 1,             // How many years to backtest (1, 2, 5, 10, 20)
  specificYear?: number,             // Or test a specific year (e.g., 2020)
  // REALISTIC COSTS (defaults are conservative estimates)
  commissionPerTrade: number = 0,    // $0 for Robinhood, ~$1 for others
  slippagePercent: number = 0.02,    // 0.02% slippage per side (realistic for liquid large-caps)
  // RISK MANAGEMENT
  yearlyDrawdownLimit: number = 15,  // Stop trading if down this % from year start
  isPaper: boolean = true            // Use paper credentials for market data
): Promise<DayTradeResult> {
  // Determine data range to fetch
  let dataRange: '1y' | '2y' | '5y' | '10y' | 'max' = '1y';
  if (yearsBack >= 20 || specificYear) {
    dataRange = 'max';
  } else if (yearsBack >= 10) {
    dataRange = '10y';
  } else if (yearsBack >= 5) {
    dataRange = '5y';
  } else if (yearsBack >= 2) {
    dataRange = '2y';
  }

  const periodLabel = specificYear ? `Year ${specificYear}` : `Last ${yearsBack} year(s)`;
  console.log(`[ORB] Starting Opening Range Breakout backtest - ${periodLabel}`);
  console.log(`[ORB] Capital: $${initialCapital}, Position: ${positionSizePercent}%, Target: +${profitTargetPercent}%, Stop: -${stopLossPercent}%`);
  console.log(`[ORB] Transaction costs: $${commissionPerTrade}/trade commission + ${slippagePercent}% slippage each way`);
  console.log(`[ORB] Yearly drawdown limit: ${yearlyDrawdownLimit}% (stop trading if hit)`);

  // Load historical data:
  // - Pre-2013: Local simulated data (historical2008.ts)
  // - 2013+: Real market data from Alpaca using your watchlist stocks
  const allData: Map<string, any[]> = new Map();
  const nowYear = new Date().getFullYear();

  // Dow Jones stalwarts used as fallbacks when a watchlist stock has insufficient data
  // (e.g. stock didn't exist at the start of the backtest period)
  const DOW_FALLBACKS = ['AAPL', 'MSFT', 'JNJ', 'KO', 'PG', 'XOM', 'JPM', 'DIS', 'MCD', 'MMM', 'CAT', 'BA', 'WMT', 'HD', 'IBM', 'CVX', 'NKE'];

  // Fetch watchlist symbols from Alpaca for a date range, substituting Dow stocks where needed
  const fetchFromAlpaca = async (startStr: string, endStr: string): Promise<void> => {
    const isConfigured = isPaper ? alpaca.isPaperConfigured() : alpaca.isLiveConfigured();
    if (!isConfigured) {
      throw new Error('Alpaca credentials required for backtesting. Connect your Alpaca account in Settings first.');
    }

    // If watchlist is empty, fall back entirely to Dow stocks
    const fetchSymbols = symbols.length > 0 ? symbols : DOW_FALLBACKS.slice(0, 5);
    if (symbols.length === 0) {
      console.warn('[ORB] Watchlist is empty — using Dow fallback stocks');
    }

    console.log(`[ORB] Fetching ${fetchSymbols.length} stocks from Alpaca (${startStr} to ${endStr})`);
    const fetchResults = await Promise.allSettled(
      fetchSymbols.map(async (sym) => ({
        symbol: sym,
        bars: await alpaca.getHistoricalBars(isPaper, sym, startStr, endStr),
      }))
    );

    const symbolsMissingData: string[] = [];
    for (let i = 0; i < fetchResults.length; i++) {
      const result = fetchResults[i];
      if (result.status === 'fulfilled' && result.value.bars.length >= 20) {
        const { symbol: sym, bars } = result.value;
        const existing = allData.get(sym) || [];
        allData.set(sym, [...existing, ...bars].sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
      } else if (result.status === 'fulfilled') {
        console.warn(`[ORB] ${result.value.symbol}: only ${result.value.bars.length} bars — will use Dow fallback`);
        symbolsMissingData.push(result.value.symbol);
      } else {
        // Fetch was rejected (API error, network error, etc.) — use Dow fallback
        console.error(`[ORB] ${fetchSymbols[i]} fetch failed:`, result.reason);
        symbolsMissingData.push(fetchSymbols[i]);
      }
    }

    // Fetch Dow fallbacks for any watchlist stocks with insufficient data
    if (symbolsMissingData.length > 0) {
      const haveData = new Set(allData.keys());
      const toFetch = DOW_FALLBACKS.filter(f => !haveData.has(f)).slice(0, symbolsMissingData.length);
      if (toFetch.length > 0) {
        console.log(`[ORB] Fetching ${toFetch.length} Dow fallbacks: ${toFetch.join(', ')}`);
        const fallbackResults = await Promise.allSettled(
          toFetch.map(async (sym) => ({
            symbol: sym,
            bars: await alpaca.getHistoricalBars(isPaper, sym, startStr, endStr),
          }))
        );
        for (let i = 0; i < fallbackResults.length; i++) {
          const result = fallbackResults[i];
          if (result.status === 'fulfilled' && result.value.bars.length >= 20) {
            const { symbol: sym, bars } = result.value;
            const existing = allData.get(sym) || [];
            allData.set(sym, [...existing, ...bars].sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
            console.log(`[ORB] Substituted ${symbolsMissingData[i]} → ${sym} (Dow fallback)`);
          }
        }
      }
    }
  };

  if (specificYear) {
    if (specificYear >= 1996 && specificYear <= 2012) {
      // Pre-2013: use local simulated data
      console.log(`[ORB] Loading SIMULATED data for ${specificYear} (pre-2013)`);
      for (const sym of getSymbolsForYear(specificYear)) {
        const data = getHistoricalData(sym, specificYear);
        if (data && data.length > 20) allData.set(sym, data);
      }
    } else if (specificYear >= 2013) {
      await fetchFromAlpaca(`${specificYear}-01-01`, `${specificYear}-12-31`);
    } else {
      throw new Error(`No data available for year ${specificYear}. Supported: 1996 onwards`);
    }
  } else {
    // Use a rolling date range: today minus N years → today
    const endDateRolling = new Date();
    const startDateRolling = new Date();
    startDateRolling.setFullYear(startDateRolling.getFullYear() - yearsBack);
    const rollingStart = startDateRolling.toISOString().split('T')[0];
    const rollingEnd = endDateRolling.toISOString().split('T')[0];
    const startYear = startDateRolling.getFullYear();
    console.log(`[ORB] Fetching data for rolling range ${rollingStart}–${rollingEnd}`);

    // Load pre-2013 simulated data if the period includes those years
    if (startYear < 2013) {
      for (let year = Math.max(startYear, 1996); year <= Math.min(2012, nowYear); year++) {
        for (const sym of getSymbolsForYear(year)) {
          const data = getHistoricalData(sym, year);
          if (data && data.length > 0) {
            const existing = allData.get(sym) || [];
            existing.push(...data);
            allData.set(sym, existing);
          }
        }
      }
      for (const [sym, data] of allData.entries()) {
        allData.set(sym, data.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
      }
    }

    // Fetch 2013+ from Alpaca using the rolling start date
    const alpacaStart = startYear >= 2013 ? rollingStart : '2013-01-01';
    await fetchFromAlpaca(alpacaStart, rollingEnd);
  }

  console.log(`[ORB] Loaded ${allData.size} stocks: ${[...allData.keys()].join(', ')}`);
  if (allData.size === 0) {
    throw new Error(
      'No market data returned from Alpaca. This usually means your API keys lack data access, ' +
      'or all requested symbols failed. Check the browser console for details. ' +
      'Note: Alpaca free-tier accounts may have limited data access.'
    );
  }

  // Find all unique trading dates
  const allDates = new Set<string>();
  allData.forEach(data => {
    data.forEach(d => allDates.add(d.timestamp));
  });
  let sortedDates = Array.from(allDates).sort();

  // Filter dates based on yearsBack or specificYear
  if (specificYear) {
    // Only include dates from the specific year
    sortedDates = sortedDates.filter(d => d.startsWith(`${specificYear}-`));

    // Count stocks that have data for this year
    let stocksWithData = 0;
    allData.forEach((data, symbol) => {
      const yearData = data.filter(d => d.timestamp.startsWith(`${specificYear}-`));
      if (yearData.length > 20) {
        stocksWithData++;
        console.log(`[ORB] ${symbol} has ${yearData.length} days in ${specificYear}`);
      } else {
        console.log(`[ORB] ${symbol} has NO DATA for ${specificYear} (only ${yearData.length} days)`);
      }
    });

    console.log(`[ORB] Filtering to year ${specificYear}: ${sortedDates.length} trading days, ${stocksWithData} stocks have data`);
  } else if (yearsBack < 20) {
    // Filter to last N years
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - yearsBack);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];
    sortedDates = sortedDates.filter(d => d >= cutoffStr);
  }

  if (sortedDates.length < 30) {
    throw new Error(
      `Not enough trading days: ${sortedDates.length} days found. ` +
      `${specificYear ? `Alpaca may not have data for year ${specificYear}. Try a more recent year (2015+).` : 'Try a shorter date range.'}` +
      ` Stocks loaded: ${[...allData.keys()].join(', ') || 'none'}.`
    );
  }

  console.log(`[ORB] Trading period: ${sortedDates[20]} to ${sortedDates[sortedDates.length - 1]} (${sortedDates.length - 20} days)`);

  let capital = initialCapital;
  let totalCostsPaid = 0;  // Track all transaction costs
  const trades: DayTradeResult['trades'] = [];
  const equityCurve: DayTradeResult['equityCurve'] = [];
  const MAX_TRADES_PER_DAY = 5;  // More trades = more compounding

  // Yearly drawdown protection tracking
  let currentYear: string | null = null;
  let yearStartCapital = initialCapital;
  let drawdownStopTriggered = false;
  let drawdownStopDate: string | null = null;
  let tradesSkippedDueToDrawdown = 0;

  // Goal tracking
  let goalReached = false;
  let goalReachedDate: string | null = null;
  let goalReachedCapital: number | null = null;

  // Helper function to calculate dynamic position size based on capital
  // Full size up to $100k, then gradually reduce to avoid market impact
  function getEffectivePositionSize(currentCapital: number): number {
    if (currentCapital <= TRADING_CONSTRAINTS.FULL_POSITION_LIMIT) {
      return positionSizePercent; // Full 25%
    }
    // Scale down linearly from 25% at $100k to 5% at $500k
    const scale = (TRADING_CONSTRAINTS.GOAL_AMOUNT - currentCapital) /
                  (TRADING_CONSTRAINTS.GOAL_AMOUNT - TRADING_CONSTRAINTS.FULL_POSITION_LIMIT);
    const scaledSize = TRADING_CONSTRAINTS.MIN_POSITION_PERCENT +
                       (positionSizePercent - TRADING_CONSTRAINTS.MIN_POSITION_PERCENT) * Math.max(0, scale);
    return Math.max(TRADING_CONSTRAINTS.MIN_POSITION_PERCENT, scaledSize);
  }

  // Start from day 20 to have some history
  // Track volatility for logging
  let lastLoggedVolatility = 0;

  for (let dayIndex = 20; dayIndex < sortedDates.length; dayIndex++) {
    const today = sortedDates[dayIndex];
    const yesterday = sortedDates[dayIndex - 1];
    let tradesToday = 0;

    // Calculate dynamic slippage based on market volatility (VIX proxy)
    const volatilityMultiplier = calculateMarketVolatility(allData, today, 20);
    const dynamicSlippage = slippagePercent * volatilityMultiplier;

    // Log when volatility changes significantly
    if (Math.abs(volatilityMultiplier - lastLoggedVolatility) >= 1.0) {
      const volatilityLevel = volatilityMultiplier <= 1.5 ? 'NORMAL' :
                              volatilityMultiplier <= 2.5 ? 'ELEVATED' :
                              volatilityMultiplier <= 4.0 ? 'HIGH' : 'PANIC';
      console.log(`[ORB] ${today}: Market volatility ${volatilityLevel} (${volatilityMultiplier.toFixed(1)}x) - Slippage: ${dynamicSlippage.toFixed(2)}%`);
      lastLoggedVolatility = volatilityMultiplier;
    }

    // Check if goal reached
    if (!goalReached && capital >= TRADING_CONSTRAINTS.GOAL_AMOUNT) {
      goalReached = true;
      goalReachedDate = today;
      goalReachedCapital = capital;
      console.log(`\n${'🎉'.repeat(20)}`);
      console.log(`[ORB] GOAL REACHED on ${today}! Capital: $${capital.toFixed(2)}`);
      console.log(`[ORB] Day trading strategy complete. Time to transition to long-term investing.`);
      console.log(`${'🎉'.repeat(20)}\n`);
    }

    // Stop trading if goal reached
    if (goalReached) {
      equityCurve.push({ date: today, equity: capital });
      continue;
    }

    // Track year changes for drawdown protection
    const todayYear = today.substring(0, 4);
    if (currentYear !== todayYear) {
      // New year - reset drawdown tracking
      currentYear = todayYear;
      yearStartCapital = capital;
      drawdownStopTriggered = false;
      drawdownStopDate = null;
      console.log(`[ORB] New year ${todayYear}: Starting capital $${capital.toFixed(2)}, drawdown limit ${yearlyDrawdownLimit}%`);
    }

    // Check if drawdown limit hit
    if (!drawdownStopTriggered) {
      const drawdownPercent = ((yearStartCapital - capital) / yearStartCapital) * 100;
      if (drawdownPercent >= yearlyDrawdownLimit) {
        drawdownStopTriggered = true;
        drawdownStopDate = today;
        console.log(`[ORB] DRAWDOWN STOP TRIGGERED on ${today}: Down ${drawdownPercent.toFixed(1)}% from year start ($${yearStartCapital.toFixed(2)} -> $${capital.toFixed(2)})`);
      }
    }

    // Skip trading if drawdown stop is active
    if (drawdownStopTriggered) {
      // Still record equity curve but don't trade
      equityCurve.push({ date: today, equity: capital });
      tradesSkippedDueToDrawdown += MAX_TRADES_PER_DAY; // Estimate of potential trades skipped
      continue;
    }

    // Find ALL breakout setups for today
    const breakouts: DayTradeSetup[] = [];

    allData.forEach((data, symbol) => {
      const todayData = data.find(d => d.timestamp === today);
      const yesterdayData = data.find(d => d.timestamp === yesterday);

      if (!todayData || !yesterdayData) return;

      // OPENING RANGE BREAKOUT CRITERIA
      // Only use data available at market open - NO LOOKAHEAD!
      // 1. Today's HIGH exceeds yesterday's HIGH (breakout happened - we verify this)
      // 2. Gap not too extreme (known at open)
      // 3. Yesterday had enough range (known at open)

      const breakoutAboveYesterdayHigh = todayData.high > yesterdayData.high;
      const gapPercent = Math.abs((todayData.open - yesterdayData.close) / yesterdayData.close) * 100;
      const isReasonableGap = gapPercent < 5; // Allow gaps up to 5%

      // Use YESTERDAY's range instead of today's (no lookahead)
      const yesterdayRange = ((yesterdayData.high - yesterdayData.low) / yesterdayData.open) * 100;
      const hasEnoughRange = yesterdayRange >= 0.5;

      // Entry would be at yesterday's high (the breakout level)
      const entryPrice = yesterdayData.high;
      const entryIsReachable = todayData.high >= entryPrice;

      if (breakoutAboveYesterdayHigh && isReasonableGap && hasEnoughRange && entryIsReachable) {
        // Score using ONLY information available at market open (NO LOOKAHEAD!)
        // - Gap direction: positive gap = bullish momentum
        // - Proximity to breakout: opening near yesterday's high = closer to trigger
        const gapDirection = (todayData.open - yesterdayData.close) / yesterdayData.close;
        const proximityToBreakout = 1 - Math.abs(todayData.open - yesterdayData.high) / yesterdayData.high;

        breakouts.push({
          symbol,
          date: today,
          open: todayData.open,
          high: todayData.high,
          low: todayData.low,
          close: todayData.close,
          prevClose: yesterdayData.close,
          gapPercent,
          dayRange: yesterdayRange,  // Use yesterday's range (no lookahead)
          // NO LOOKAHEAD: score uses only data available at market open
          score: gapDirection * 50 + proximityToBreakout * 50,
        });
      }
    });

    // Sort by score (using only pre-entry data) and take top setups
    breakouts.sort((a, b) => b.score - a.score);

    for (const setup of breakouts.slice(0, MAX_TRADES_PER_DAY)) {
      if (tradesToday >= MAX_TRADES_PER_DAY) break;

      // Entry at the breakout level (yesterday's high)
      const yesterdayData = allData.get(setup.symbol)?.find(d => d.timestamp === yesterday);
      if (!yesterdayData) continue;

      const entryPrice = yesterdayData.high;
      // Use dynamic position size based on capital (scales down as portfolio grows)
      const effectivePositionPercent = getEffectivePositionSize(capital);
      const positionDollars = capital * (effectivePositionPercent / 100);

      if (positionDollars < 100) continue; // Need at least $100 to trade (realistic minimum)

      const profitTarget = entryPrice * (1 + profitTargetPercent / 100);
      const stopLoss = entryPrice * (1 - stopLossPercent / 100);

      // Simulate: did we hit profit target or stop loss?
      let exitPrice: number;
      let outcome: 'WIN' | 'LOSS' | 'SCRATCH';

      const hitProfit = setup.high >= profitTarget;
      const hitStop = setup.low <= stopLoss;

      if (hitProfit && !hitStop) {
        exitPrice = profitTarget;
        outcome = 'WIN';
      } else if (hitStop && !hitProfit) {
        exitPrice = stopLoss;
        outcome = 'LOSS';
      } else if (hitProfit && hitStop) {
        // Both possible - use close direction as hint
        if (setup.close > entryPrice) {
          exitPrice = profitTarget;
          outcome = 'WIN';
        } else {
          exitPrice = stopLoss;
          outcome = 'LOSS';
        }
      } else {
        // Neither hit - exit at close
        exitPrice = setup.close;
        outcome = exitPrice > entryPrice ? 'WIN' : exitPrice < entryPrice ? 'LOSS' : 'SCRATCH';
      }

      // Use dollar-based P&L (not share-based) for accurate calculation
      // THEN subtract realistic transaction costs
      const grossPnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
      const grossPnlDollars = positionDollars * (grossPnlPercent / 100);

      // Transaction costs:
      // 1. Commission per trade (buy + sell = 2 commissions)
      const totalCommission = commissionPerTrade * 2;
      // 2. Slippage: you buy at slightly higher, sell at slightly lower
      //    Uses DYNAMIC slippage based on market volatility (higher in panic conditions)
      //    Entry slippage: lose dynamicSlippage on entry
      //    Exit slippage: lose dynamicSlippage on exit
      const slippageCost = positionDollars * (dynamicSlippage / 100) * 2; // both entry and exit

      const totalCosts = totalCommission + slippageCost;
      totalCostsPaid += totalCosts;  // Track cumulative costs
      const pnlDollars = grossPnlDollars - totalCosts;
      const pnlPercent = (pnlDollars / positionDollars) * 100;

      capital += pnlDollars;
      tradesToday++;

      trades.push({
        date: today,
        symbol: setup.symbol,
        entry: entryPrice,
        exit: exitPrice,
        pnlPercent,
        pnlDollars,
        outcome,
      });

      if (trades.length <= 15 || trades.length % 100 === 0) {
        console.log(`[ORB] ${today} ${setup.symbol}: ${outcome} ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}% ($${pnlDollars.toFixed(2)}) | Capital: $${capital.toFixed(2)}`);
      }
    }

    // Record equity curve
    equityCurve.push({ date: today, equity: capital });
  }

  // Calculate final statistics
  const winningTrades = trades.filter(t => t.outcome === 'WIN');
  const losingTrades = trades.filter(t => t.outcome === 'LOSS');

  const avgWinPercent = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / winningTrades.length
    : 0;
  const avgLossPercent = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + t.pnlPercent, 0) / losingTrades.length
    : 0;

  // ============ REALISTIC HAIRCUT CALCULATION ============
  // Apply real-world adjustments that backtests don't capture
  const haircutReasons: string[] = [];
  let totalHaircutPercent = 0;
  const rawReturn = ((capital - initialCapital) / initialCapital) * 100;

  // 1. BASE EXECUTION HAIRCUT (10-15%)
  // Real orders don't fill perfectly at limit prices
  const baseHaircut = 12;
  totalHaircutPercent += baseHaircut;
  haircutReasons.push(`Base execution slippage: -${baseHaircut}%`);

  // 2. TRADE FREQUENCY HAIRCUT (0-10%)
  // More trades = more chances for mistakes, missed fills, emotional errors
  const tradesPerDay = trades.length / Math.max(1, sortedDates.length - 20);
  const frequencyHaircut = Math.min(10, tradesPerDay * 2);
  if (frequencyHaircut > 2) {
    totalHaircutPercent += frequencyHaircut;
    haircutReasons.push(`High trade frequency (${tradesPerDay.toFixed(1)}/day): -${frequencyHaircut.toFixed(0)}%`);
  }

  // 3. VOLATILITY/CRISIS HAIRCUT (0-20%)
  // Detect months with extreme losses - these would be worse in reality
  const monthlyReturns: Record<string, number> = {};
  trades.forEach(t => {
    const month = t.date.substring(0, 7); // YYYY-MM
    monthlyReturns[month] = (monthlyReturns[month] || 0) + t.pnlPercent;
  });
  const worstMonth = Math.min(...Object.values(monthlyReturns), 0);
  const crisisMonths = Object.values(monthlyReturns).filter(r => r < -10).length;

  if (crisisMonths > 0) {
    const crisisHaircut = Math.min(20, crisisMonths * 5 + Math.abs(worstMonth) * 0.3);
    totalHaircutPercent += crisisHaircut;
    haircutReasons.push(`Crisis periods (${crisisMonths} bad months, worst: ${worstMonth.toFixed(0)}%): -${crisisHaircut.toFixed(0)}%`);
  }

  // 4. SIMULATED DATA HAIRCUT (15% for pre-2013 data)
  const isSimulatedData = specificYear && specificYear < 2013;
  if (isSimulatedData) {
    const simHaircut = 15;
    totalHaircutPercent += simHaircut;
    haircutReasons.push(`Simulated data (pre-2013): -${simHaircut}% (results less reliable)`);
  }

  // 5. TAX HAIRCUT (show after-tax estimate)
  // Short-term capital gains taxed as income (~25-35% for most)
  if (rawReturn > 0) {
    const taxRate = 30; // Assume 30% bracket
    const taxHaircut = rawReturn * (taxRate / 100) * 0.5; // Apply to gains portion
    totalHaircutPercent += taxHaircut / Math.max(1, rawReturn) * 10;
    haircutReasons.push(`Estimated taxes (~${taxRate}% on gains): significant`);
  }

  // Cap total haircut at 60% (don't turn big winners into losers unrealistically)
  totalHaircutPercent = Math.min(60, totalHaircutPercent);

  // Calculate realistic return
  // If raw return is positive, reduce it by haircut %
  // If raw return is negative, make it worse by haircut %
  let realisticReturn: number;
  if (rawReturn >= 0) {
    realisticReturn = rawReturn * (1 - totalHaircutPercent / 100);
  } else {
    realisticReturn = rawReturn * (1 + totalHaircutPercent / 200); // Losses get 50% worse
  }
  const realisticFinalCapital = initialCapital * (1 + realisticReturn / 100);

  console.log(`[HAIRCUT] Raw return: ${rawReturn >= 0 ? '+' : ''}${rawReturn.toFixed(1)}%`);
  console.log(`[HAIRCUT] Total haircut: ${totalHaircutPercent.toFixed(0)}%`);
  console.log(`[HAIRCUT] Realistic estimate: ${realisticReturn >= 0 ? '+' : ''}${realisticReturn.toFixed(1)}%`);
  haircutReasons.forEach(r => console.log(`[HAIRCUT]   ${r}`));

  const result: DayTradeResult = {
    initialCapital,
    finalCapital: capital,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
    totalReturnPercent: ((capital - initialCapital) / initialCapital) * 100,
    avgWinPercent,
    avgLossPercent,
    bestDay: trades.length > 0 ? Math.max(...trades.map(t => t.pnlPercent)) : 0,
    worstDay: trades.length > 0 ? Math.min(...trades.map(t => t.pnlPercent)) : 0,
    totalCosts: totalCostsPaid,
    drawdownStopTriggered,
    drawdownStopDate,
    tradesSkippedDueToDrawdown,
    goalReached,
    goalReachedDate,
    goalReachedCapital,
    // Realistic estimates
    realisticReturnPercent: realisticReturn,
    realisticFinalCapital,
    haircutPercent: totalHaircutPercent,
    haircutReasons,
    trades,
    equityCurve,
  };

  console.log(`\n[DAY TRADE] ========== RESULTS ==========`);
  console.log(`[DAY TRADE] Initial Capital: $${initialCapital.toFixed(2)}`);
  console.log(`[DAY TRADE] Final Capital: $${capital.toFixed(2)}`);
  console.log(`[DAY TRADE] Total Return: ${result.totalReturnPercent >= 0 ? '+' : ''}${result.totalReturnPercent.toFixed(2)}%`);
  console.log(`[DAY TRADE] Total Trades: ${trades.length}`);
  console.log(`[DAY TRADE] Win Rate: ${result.winRate.toFixed(1)}% (${winningTrades.length}W / ${losingTrades.length}L)`);
  console.log(`[DAY TRADE] Avg Win: +${avgWinPercent.toFixed(2)}%`);
  console.log(`[DAY TRADE] Avg Loss: ${avgLossPercent.toFixed(2)}%`);
  console.log(`[DAY TRADE] Best Day: +${result.bestDay.toFixed(2)}%`);
  console.log(`[DAY TRADE] Worst Day: ${result.worstDay.toFixed(2)}%`);
  console.log(`[DAY TRADE] Total Transaction Costs: $${totalCostsPaid.toFixed(2)} (${((totalCostsPaid / initialCapital) * 100).toFixed(0)}% of initial capital)`);
  if (goalReached) {
    console.log(`[DAY TRADE] 🎉 GOAL REACHED on ${goalReachedDate}! Capital: $${goalReachedCapital?.toFixed(2)}`);
  }
  if (drawdownStopTriggered) {
    console.log(`[DAY TRADE] DRAWDOWN PROTECTION: Stopped trading on ${drawdownStopDate} (saved from further losses)`);
  }
  console.log(`[DAY TRADE] ==============================\n`);

  return result;
}
