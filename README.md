# AutoTradeApp

A realistic stock trading backtester and paper trading platform built with React + TypeScript + Vite.

## Features

### Backtesting Engine
- **Opening Range Breakout (ORB) Strategy**: Tests breakout trades with configurable profit targets and stop losses
- **Real Historical Data**: 53 major stocks from 2013-2025 (Yahoo Finance data, stored locally)
- **Simulated Historical Data**: 30 stocks from 1996-2012 for extended backtesting
- **No API Rate Limits**: All historical data is pre-downloaded (174,000+ days of price data)

### Realistic Cost Modeling
- **Transaction Costs**: Configurable slippage (default 0.02% for liquid large-caps)
- **Dynamic Volatility Adjustment**: Higher slippage during high-volatility periods
- **Zero Commission**: Reflects modern brokers like Robinhood

### Risk Management
- **PDT Compliance**: $25,000 minimum capital requirement
- **Yearly Drawdown Protection**: Stops trading if down 15% from year start
- **Position Scaling**: Reduces position size as portfolio grows ($100k+ scales down)
- **$500k Goal**: Auto-stops day trading when goal reached with transition advice

### Realistic Estimate (Haircut System)
The backtester applies real-world adjustments to raw results:
- **Base Execution Slippage** (-12%): Real orders don't fill at perfect prices
- **Trade Frequency Penalty** (0-10%): More trades = more mistakes
- **Crisis Period Adjustment** (0-20%): Volatile months are worse in reality
- **Simulated Data Penalty** (-15%): Pre-2013 data is less reliable
- **Tax Consideration**: Reminds you of short-term capital gains impact

### Sample 10-Year Results (2016-2025)
```
Raw Backtest:     $25,000 → $500,229 (+1,901%)
Realistic Est:    $25,000 → $296,281 (+1,085%)
Haircut Applied:  -43%

Win Rate:         49.4% (5,281W / 5,359L)
Avg Win/Loss:     +1.21% / -0.89%
Total Trades:     10,687
Transaction Costs: $140,561
```

## How It Works

### Opening Range Breakout Strategy
1. **Entry**: When price breaks above yesterday's high
2. **Profit Target**: +2% from entry
3. **Stop Loss**: -1% from entry (2:1 reward/risk)
4. **Exit**: Hit target, hit stop, or close at end of day

### Data Flow
```
Yahoo Finance → downloadHistoricalData.ts → yahooHistorical.json
                                                    ↓
                                            backtester.ts
                                                    ↓
                                            Dashboard.tsx
```

### No Lookahead Bias
The backtester only uses information available at trade entry:
- Yesterday's OHLCV data
- Today's opening price
- Gap direction and size

It does NOT cheat by using today's high/low to select trades.

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Updating Historical Data

To refresh the Yahoo data (e.g., after each year ends):

```bash
npx tsx scripts/downloadHistoricalData.ts
```

This downloads fresh data and saves it to `src/data/yahooHistorical.json`.

## Tech Stack
- **Frontend**: React 18 + TypeScript
- **Build**: Vite
- **State**: Zustand
- **Styling**: Tailwind CSS
- **Charts**: Lightweight Charts (TradingView)
- **Data**: Yahoo Finance (historical), Binance (crypto real-time)

## Final Thoughts

This backtester was built to tell the truth, not to sell dreams.

**The reality of day trading:**
- Most day traders lose money (studies show 70-90% lose)
- Transaction costs compound brutally over thousands of trades
- Backtests always look better than real trading
- Emotions, mistakes, and execution issues aren't modeled

**What the data shows:**
- A ~49% win rate with 1.2:1 reward/risk is a real (small) edge
- The edge exists, but it's fragile and requires discipline
- After realistic adjustments, expect 50-60% of backtest returns
- Taxes take another 25-35% of gains (short-term capital gains)

**If you pursue this:**
1. Paper trade for 3-6 months first
2. Start with minimum position sizes
3. Track every trade and review weekly
4. Have a day job - don't depend on trading income
5. Consider if your time is better spent on index funds

The best trade might be putting $25k in VOO and checking back in 10 years.

---

*Built with the assistance of Claude (Anthropic). MVP released February 2026.*
