# AutoTradeApp

An automated trading platform built with React + TypeScript, connected to Alpaca Markets for real paper and live trading. Includes an Opening Range Breakout (ORB) day trading strategy and a swing scanner that trades both long and short based on trend, RSI, and MACD signals.

**Goal: Grow $25,000 → $500,000 through disciplined, rules-based day trading.**

---

## How It Works

### Strategy: Opening Range Breakout (ORB)

1. **Opening Range** — The high and low of each watchlist stock between 9:30–10:00 AM ET are recorded
2. **Breakout Signal** — After 10:00 AM ET, if price closes above the opening range high, a trade is triggered
3. **Bracket Order** — A buy order is placed with automatic take profit (+2%) and stop loss (-1%) legs managed server-side by Alpaca
4. **One trade per symbol per day** — No re-entry; scanner stops at 3:30 PM ET

### Strategy: Swing Scanner (Long + Short)

Runs via GitHub Actions on weekdays at 9:35 AM and 3:45 PM ET. Analyzes the swing watchlist using daily bars and places GTC bracket orders.

| Regime | Direction | Entry Signal | Take Profit | Stop Loss |
|--------|-----------|-------------|-------------|-----------|
| **Uptrend** (price > SMA50) | Long | RSI 30–50 pullback + MACD improving | 15% | 5% |
| **Sideways** (near SMA50) | Long | RSI < 35 + MACD histogram up | 8% | 4% |
| **Downtrend** (price < SMA50) | Short | RSI 50–70 bounce + MACD fading | 8% | 4% |

- $100 per trade, max 5 concurrent positions
- Bracket orders are GTC — TP and SL execute automatically on Alpaca
- Uses separate Alpaca credentials (`ALPACA_SWING_KEY_ID` / `ALPACA_SWING_SECRET_KEY`)

### Risk Management
- **$3,750 per trade** (15% of $25k mental budget — as portfolio grows, % risk naturally shrinks)
- **+2% take profit** → +$75 per winner
- **-1% stop loss** → -$37.50 per loser
- **2:1 reward/risk** — break even at 34% win rate
- **Daily exposure cap** — bounded by available buying power × max trades per day
- **Yearly drawdown protection** — stops auto-trading if down 15% from year start
- **Trading hours only** — no overnight positions

### Paper → Live Pathway
1. Connect Alpaca paper account in Settings
2. Enable auto-trading — ORB scanner watches your watchlist during market hours
3. Validate strategy profitability over weeks/months in paper mode
4. Switch to live when confident — auto-trading disables automatically on mode switch (must re-enable manually)

---

## Features

### Live Auto-Trading (Alpaca Markets)
- ORB scanner polls every 60 seconds during market hours
- Bracket orders placed server-side — executes even when browser tab is hidden
- Duplicate order protection — checks existing Alpaca positions before placing
- Paper and live accounts managed separately — impossible to mix credentials

### Dashboard
- Real-time portfolio value, buying power, gain/loss, day change
- ORB Scanner status card with live opening ranges and breakout tracking
- Daily exposure progress bar (warns at 80% of cap)
- Portfolio performance chart (history of paper account equity)
- Quick backtester — run ORB strategy across full watchlist in seconds

### Manual Trading
- Buy/sell/short/cover any symbol via Alpaca
- Market and limit order support
- Routes to paper or live account based on current trading mode

### Backtesting Engine
- **Real historical data**: 53 major stocks from 2013–2025 (Yahoo Finance)
- **Simulated data**: 30 stocks from 1996–2012 for extended testing
- No API rate limits — all data pre-downloaded (174,000+ days of price data)
- Realistic cost modeling: configurable slippage, zero commission
- Yearly drawdown protection and position scaling built into backtests
- Haircut system applies real-world adjustments to raw backtest results

### Backtested Results (ORB, 10 Years, 2016–2025)
```
Raw:       $25,000 → $500,229  (+1,901%)
Realistic: $25,000 → $296,281  (+1,085%)
Haircut:   -43% (slippage, execution variance, data imperfection)

Win Rate:  49.4% (5,281W / 5,359L)
Avg Win:   +1.21%  |  Avg Loss: -0.89%
Trades:    10,687  |  Transaction Costs: $140,561
```

### Settings & Configuration
- Alpaca paper and live credentials stored separately in localStorage
- Auto-trade config: max $ per trade, max trades per day, yearly drawdown limit
- Watchlist management (permanent list + user additions)
- Trading rules: candlestick patterns, MACD crossover, price alerts

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Connect Alpaca
1. Create a free account at [alpaca.markets](https://alpaca.markets)
2. Go to Settings → Alpaca Markets → connect paper account
3. Click "Sync Portfolio" to pull account data
4. Add stocks to your watchlist
5. Enable Auto-Trading

### Update Historical Backtest Data
```bash
npx tsx scripts/downloadHistoricalData.ts
```
Downloads fresh Yahoo Finance data to `src/data/yahooHistorical.json`.

---

## Tech Stack
- **Frontend**: React 18 + TypeScript
- **Build**: Vite
- **State**: Zustand (with localStorage persistence)
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Broker**: Alpaca Markets API (paper + live)
- **Hosting**: Firebase Hosting
- **CI/CD**: GitHub Actions (push to main = deploy)

---

## TODO

- [ ] **Switch to live Alpaca account** — When ready, update GitHub Actions secrets (`ALPACA_SWING_KEY_ID` and `ALPACA_SWING_SECRET_KEY`) to use live API keys, and set `ALPACA_LIVE: 'true'` in the swing-scanner workflow env. Currently running in paper mode.

---

## Reality Check

This app was built to trade with discipline, not emotion. Before going live:

- **Paper trade for at least 1–3 months** — validate the strategy holds in current market conditions
- **A 49% win rate with 2:1 R/R is a real edge** — but it's fragile and requires strict adherence to rules
- **Backtests always look better than live trading** — expect 50–60% of backtest returns
- **Taxes matter** — short-term capital gains are taxed as ordinary income (25–37%)
- **Most day traders lose money** — studies consistently show 70–90% of retail day traders underperform

The best trade might still be putting $25k in VOO and checking back in 10 years.

---

*Built with the assistance of [Claude](https://claude.ai) (Anthropic). MVP released February 2026.*
