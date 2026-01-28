// Auto-Trading Service
// Handles automatic trade execution with safety controls

import type { TradingRule, AutoTradeConfig, AutoTradeExecution, Alert, TradingMode } from '../types';
import { useStore } from '../store/useStore';
import { ibkr } from './ibkr';
import { getQuote } from './alphaVantage';
import { getBinancePrice, isCryptoSymbol } from './binanceApi';
import { registerPositionForMonitoring, registerShortPositionForMonitoring } from './positionMonitor';

// Check if current time is within market hours (9:30 AM - 4:00 PM ET)
export function isWithinTradingHours(): boolean {
  const now = new Date();
  // Convert to ET (Eastern Time)
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Market hours: 9:30 AM (570 min) to 4:00 PM (960 min)
  return timeInMinutes >= 570 && timeInMinutes <= 960;
}

// Check if a rule can be auto-executed
export function canExecuteAutoTrade(
  rule: TradingRule,
  config: AutoTradeConfig
): { allowed: boolean; reason?: string } {
  // Check if auto-trading is enabled globally
  if (!config.enabled) {
    return { allowed: false, reason: 'Auto-trading is disabled' };
  }

  // Check if rule has auto-trade enabled
  if (!rule.autoTrade) {
    return { allowed: false, reason: 'Auto-trade not enabled for this rule' };
  }

  // Check if in live mode without IBKR connected
  const state = useStore.getState();
  if (state.tradingMode === 'live' && !state.ibkrConnected) {
    return { allowed: false, reason: 'Live mode requires IBKR connection. Switch to Paper mode or connect IBKR.' };
  }

  // Check trading hours if required
  if (config.tradingHoursOnly && !isWithinTradingHours()) {
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return { allowed: false, reason: `Outside trading hours (current ET: ${etTime.toLocaleTimeString()}, market: 9:30 AM - 4:00 PM)` };
  }

  // Check cooldown period
  if (rule.lastExecutedAt) {
    const cooldownMs = rule.cooldownMinutes * 60 * 1000;
    const timeSinceLastExecution = Date.now() - new Date(rule.lastExecutedAt).getTime();
    if (timeSinceLastExecution < cooldownMs) {
      const remainingMins = Math.ceil((cooldownMs - timeSinceLastExecution) / 60000);
      return { allowed: false, reason: `Cooldown active (${remainingMins} min remaining)` };
    }
  }

  // Check daily trade limit
  const todayCount = getTodayAutoTradeCount();
  if (todayCount >= config.maxTradesPerDay) {
    return { allowed: false, reason: `Daily limit reached (${config.maxTradesPerDay} trades)` };
  }

  return { allowed: true };
}

// Get count of auto-trades executed today
export function getTodayAutoTradeCount(): number {
  const state = useStore.getState();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return state.autoTradeExecutions.filter(
    (e) => new Date(e.timestamp) >= today && e.status === 'executed'
  ).length;
}

// Execute an auto-trade
export async function executeAutoTrade(
  alert: Alert,
  rule: TradingRule,
  mode: TradingMode,
  config: AutoTradeConfig
): Promise<AutoTradeExecution> {
  const execution: AutoTradeExecution = {
    id: crypto.randomUUID(),
    ruleId: rule.id,
    ruleName: rule.name,
    alertId: alert.id,
    symbol: alert.symbol,
    type: rule.type,
    shares: 0, // Will be calculated after getting price
    price: 0,
    total: 0,
    status: 'pending',
    mode,
    timestamp: new Date(),
  };

  try {
    // Get current price - use Binance for crypto, Alpha Vantage for stocks
    let currentPrice: number | null = null;
    if (isCryptoSymbol(alert.symbol)) {
      currentPrice = await getBinancePrice(alert.symbol);
    } else {
      const quote = await getQuote(alert.symbol);
      currentPrice = quote?.price ?? null;
    }

    if (currentPrice === null || currentPrice <= 0) {
      throw new Error(`Could not get price for ${alert.symbol}`);
    }

    execution.price = currentPrice;

    // Calculate shares based on rule action
    if (rule.action.targetDollarAmount && execution.price > 0) {
      // Buy a specific dollar amount worth - minimum 1 share
      execution.shares = Math.max(1, Math.floor(rule.action.targetDollarAmount / execution.price));
    } else {
      // Use fixed shares with max position size limit
      execution.shares = Math.min(rule.action.shares || 10, config.maxPositionSize);
    }

    // Ensure we always trade at least 1 share
    if (execution.shares < 1) {
      execution.shares = 1;
    }

    execution.total = execution.shares * execution.price;

    const isLiveMode = mode === 'live';

    if (isLiveMode) {
      // Execute via IBKR
      const conid = await ibkr.getConidForSymbol(alert.symbol);
      if (!conid) {
        throw new Error(`Could not find contract for ${alert.symbol}`);
      }

      if (rule.type === 'buy') {
        await ibkr.buyMarket(conid, execution.shares);
      } else {
        await ibkr.sellMarket(conid, execution.shares);
      }

      // Sync portfolio after trade
      setTimeout(() => {
        useStore.getState().syncFromIBKR();
      }, 2000);
    } else {
      // Paper trading - update paper portfolio
      const state = useStore.getState();
      const paperPositions = state.paperPortfolio.positions;

      if (rule.type === 'buy') {
        // Check if we have enough cash
        if (execution.total > state.paperPortfolio.cashBalance) {
          throw new Error('Insufficient funds in paper portfolio');
        }

        // Update paper portfolio
        useStore.setState((s) => ({
          paperPortfolio: {
            ...s.paperPortfolio,
            cashBalance: s.paperPortfolio.cashBalance - execution.total,
          },
        }));

        // Update or create position
        const existingPosition = paperPositions.find((p) => p.symbol === alert.symbol);
        if (existingPosition) {
          const newShares = existingPosition.shares + execution.shares;
          const newTotalCost = existingPosition.avgCost * existingPosition.shares + execution.total;
          const newAvgCost = newTotalCost / newShares;
          state.updatePaperPosition(alert.symbol, newShares, newAvgCost, execution.price);
        } else {
          state.updatePaperPosition(alert.symbol, execution.shares, execution.price, execution.price);
        }

        // Initialize highestPrice for new position (for trailing stop)
        const newPosition = useStore.getState().paperPortfolio.positions.find((p) => p.symbol === alert.symbol);
        if (newPosition && !newPosition.highestPrice) {
          useStore.setState((s) => ({
            paperPortfolio: {
              ...s.paperPortfolio,
              positions: s.paperPortfolio.positions.map((p) =>
                p.symbol === alert.symbol ? { ...p, highestPrice: execution.price } : p
              ),
            },
          }));
        }

        // Add trade record for BUY
        state.addPaperTrade({
          id: crypto.randomUUID(),
          symbol: alert.symbol,
          type: 'buy',
          shares: execution.shares,
          price: execution.price,
          total: execution.total,
          date: new Date(),
          notes: `Auto-trade: ${rule.name}`,
        });
      } else if (rule.type === 'short') {
        // SHORT - Open a short position (profit when price goes DOWN)
        const success = state.openShortPosition(alert.symbol, execution.shares, execution.price);
        if (!success) {
          throw new Error('Could not open short position - insufficient margin');
        }
      } else if (rule.type === 'cover') {
        // COVER - Close a short position (buy back shares)
        const success = state.coverShortPosition(alert.symbol, execution.shares, execution.price);
        if (!success) {
          throw new Error('Could not cover short - no short position or insufficient shares');
        }
      } else {
        // Sell (close long position)
        const existingPosition = paperPositions.find((p) => p.symbol === alert.symbol);
        if (!existingPosition || existingPosition.shares < execution.shares) {
          throw new Error('Insufficient shares in paper portfolio');
        }

        // Update paper portfolio
        useStore.setState((s) => ({
          paperPortfolio: {
            ...s.paperPortfolio,
            cashBalance: s.paperPortfolio.cashBalance + execution.total,
          },
        }));

        const newShares = existingPosition.shares - execution.shares;
        state.updatePaperPosition(alert.symbol, newShares, existingPosition.avgCost, execution.price);

        // Add trade to paper portfolio
        state.addPaperTrade({
          id: crypto.randomUUID(),
          symbol: alert.symbol,
          type: rule.type,
          shares: execution.shares,
          price: execution.price,
          total: execution.total,
          date: new Date(),
          notes: `Auto-trade: ${rule.name}`,
        });
      }
    }

    execution.status = 'executed';

    // Clear, prominent trade logging
    const tradeEmoji = rule.type === 'buy' ? '🟢' : rule.type === 'short' ? '🔻' : rule.type === 'cover' ? '🔺' : '🔴';
    const tradeAction = rule.type === 'short' ? 'SHORT' : rule.type === 'cover' ? 'COVER' : rule.type.toUpperCase();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${tradeEmoji} AUTO-TRADE EXECUTED: ${tradeAction} ${alert.symbol}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   Rule: ${rule.name}`);
    console.log(`   Shares: ${execution.shares}`);
    console.log(`   Price: $${execution.price.toFixed(2)}`);
    console.log(`   Total: $${execution.total.toFixed(2)}`);
    if (rule.type === 'buy') {
      console.log(`   ---`);
      console.log(`   Stop Loss: $${(execution.price * (1 - (rule.stopLossPercent || 1) / 100)).toFixed(2)} (-${rule.stopLossPercent || 1}%)`);
      console.log(`   Trailing Stop: ${rule.trailingStopPercent || 0.75}% from high`);
    } else if (rule.type === 'short') {
      console.log(`   ---`);
      console.log(`   Stop Loss (cover if price rises): $${(execution.price * (1 + (rule.stopLossPercent || 1) / 100)).toFixed(2)} (+${rule.stopLossPercent || 1}%)`);
      console.log(`   Trailing Stop: ${rule.trailingStopPercent || 0.75}% from low`);
    }
    console.log(`${'='.repeat(60)}\n`);

    // Update rule's last executed timestamp
    useStore.getState().updateTradingRule(rule.id, { lastExecutedAt: new Date() });

    // Register position for take-profit/stop-loss/trailing-stop monitoring
    if (rule.type === 'buy') {
      if (rule.takeProfitPercent || rule.stopLossPercent || rule.trailingStopPercent) {
        // Small delay to ensure state is updated
        setTimeout(() => {
          const state = useStore.getState();
          const position = state.paperPortfolio.positions.find((p) => p.symbol === alert.symbol);
          if (position) {
            console.log(`📊 Registering ${alert.symbol} for monitoring (TP: ${rule.takeProfitPercent || 'none'}%, SL: ${rule.stopLossPercent || 'none'}%, Trail: ${rule.trailingStopPercent || 'none'}%)`);
            registerPositionForMonitoring(position, rule);
          } else {
            console.warn(`⚠️ Could not find position for ${alert.symbol} to register for monitoring`);
          }
        }, 100);
      } else {
        console.warn(`⚠️ Rule "${rule.name}" has no take-profit, stop-loss, or trailing-stop configured - position will NOT be auto-sold!`);
      }
    }

    // Register SHORT position for monitoring (stop loss and trailing stop work inversely)
    if (rule.type === 'short') {
      if (rule.stopLossPercent || rule.trailingStopPercent) {
        setTimeout(() => {
          const state = useStore.getState();
          const shortPosition = state.paperPortfolio.shortPositions?.find((p) => p.symbol === alert.symbol);
          if (shortPosition) {
            console.log(`📊 Registering SHORT ${alert.symbol} for monitoring (SL: ${rule.stopLossPercent || 'none'}%, Trail: ${rule.trailingStopPercent || 'none'}%)`);
            registerShortPositionForMonitoring(shortPosition, rule);
          } else {
            console.warn(`⚠️ Could not find short position for ${alert.symbol} to register for monitoring`);
          }
        }, 100);
      } else {
        console.warn(`⚠️ Short rule "${rule.name}" has no stop-loss or trailing-stop configured - position will NOT be auto-covered!`);
      }
    }
  } catch (error) {
    execution.status = 'failed';
    execution.error = error instanceof Error ? error.message : 'Unknown error';
  }

  // Add execution to store
  useStore.getState().addAutoTradeExecution(execution);

  return execution;
}
