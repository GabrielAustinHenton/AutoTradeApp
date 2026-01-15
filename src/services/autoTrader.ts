// Auto-Trading Service
// Handles automatic trade execution with safety controls

import type { TradingRule, AutoTradeConfig, AutoTradeExecution, Alert, TradingMode } from '../types';
import { useStore } from '../store/useStore';
import { ibkr } from './ibkr';
import { getQuote } from './alphaVantage';

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

  // Check trading hours if required
  if (config.tradingHoursOnly && !isWithinTradingHours()) {
    return { allowed: false, reason: 'Outside trading hours' };
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
    shares: Math.min(rule.action.shares || 10, config.maxPositionSize),
    price: 0,
    total: 0,
    status: 'pending',
    mode,
    timestamp: new Date(),
  };

  try {
    // Get current price
    const quote = await getQuote(alert.symbol);
    execution.price = quote.price;
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
      } else {
        // Sell
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
      }

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

    execution.status = 'executed';

    // Update rule's last executed timestamp
    useStore.getState().updateTradingRule(rule.id, { lastExecutedAt: new Date() });
  } catch (error) {
    execution.status = 'failed';
    execution.error = error instanceof Error ? error.message : 'Unknown error';
  }

  // Add execution to store
  useStore.getState().addAutoTradeExecution(execution);

  return execution;
}
