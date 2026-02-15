# AutoTradeApp - Architecture & Overview

## What Is This?

AutoTradeApp is a realistic stock trading platform that combines backtesting, paper trading, swing trading, and live broker integration (Interactive Brokers). It prioritizes honest results over hype — backtests include realistic cost modeling so you see what to actually expect.

**Live URL**: Hosted on Firebase Hosting (autotrader-1e44e)

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + TypeScript | React 19, TS 5.9 |
| Build | Vite | 7.x |
| State | Zustand | 5.x |
| Styling | Tailwind CSS | 4.x |
| Charts | Recharts | 3.x |
| Routing | React Router | 7.x |
| Auth | Firebase Auth | 12.x |
| Database | Cloud Firestore | 12.x |
| Hosting | Firebase Hosting | — |
| Broker | Interactive Brokers Client Portal API | — |
| Proxy | Express.js (CORS proxy on Google Cloud VM) | — |
| Testing | Vitest + React Testing Library | — |

---

## Project Structure

```
src/
├── pages/                  # Main UI pages
│   ├── Dashboard.tsx       # Home: backtesting & performance overview
│   ├── Trade.tsx           # Execute manual trades
│   ├── Portfolio.tsx       # Holdings & account overview
│   ├── Rules.tsx           # Define automated trading rules
│   ├── Backtest.tsx        # Run historical backtests
│   ├── Charts.tsx          # Price charts with pattern detection
│   ├── SwingTrader.tsx     # Multi-day swing trading
│   ├── Journal.tsx         # Trade journal with notes
│   ├── TradeHistory.tsx    # Trade log viewer
│   ├── Settings.tsx        # App configuration
│   └── Auth.tsx            # Login/signup
│
├── services/               # Core business logic
│   ├── backtester.ts       # Backtest engine (ORB, RSI, patterns, hybrid)
│   ├── ibkr.ts             # Interactive Brokers API wrapper
│   ├── candlestickPatterns.ts  # 9 candlestick pattern detectors
│   ├── swingTrader.ts      # Swing trading with regime detection
│   ├── autoTrader.ts       # Automated rule execution
│   ├── positionMonitor.ts  # Take-profit & stop-loss monitoring
│   ├── alphaVantage.ts     # Market data providers (Alpha Vantage, Twelve Data, etc.)
│   ├── binanceApi.ts       # Crypto real-time data (Binance)
│   └── firestoreSync.ts    # Cloud data synchronization
│
├── store/                  # Zustand state management
│   ├── useStore.ts         # Main trading state (50+ actions)
│   └── useSwingStore.ts    # Swing trader state
│
├── components/             # Reusable UI components
│   ├── layout/             # App shell, sidebar navigation
│   ├── charts/             # Chart components
│   ├── portfolio/          # Portfolio card components
│   └── alerts/             # Alert system
│
├── hooks/                  # Custom React hooks
│   ├── useStockData.ts     # Real-time quote fetching
│   ├── usePatternScanner.ts    # Candlestick pattern scanning
│   ├── usePositionMonitor.ts   # Trade monitoring
│   └── useIBKRKeepAlive.ts     # IBKR session management
│
├── contexts/
│   └── AuthContext.tsx      # Firebase auth state provider
│
├── config/
│   ├── firebase.ts          # Firebase initialization (env vars)
│   ├── ibkr.ts              # IBKR connection settings
│   └── watchlist.ts         # Default trading symbols
│
├── data/                    # Pre-downloaded historical data
│   ├── yahooHistorical.ts   # 53 stocks, 2013-2025
│   └── historical2008.ts    # 30 stocks, 1996-2012
│
├── types/                   # TypeScript type definitions
└── utils/                   # Utility functions
```

### Other Top-Level Directories

```
server/                      # IBKR CORS proxy (Express.js)
scripts/                     # Data download scripts
docs/                        # Documentation
public/                      # Static assets
dist/                        # Production build output
```

---

## Architecture

### Data Flow

```
                    ┌─────────────────────────┐
                    │    Firebase Hosting      │
                    │   (serves built app)     │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      React Frontend      │
                    │  (Vite + React Router)   │
                    └──┬──────┬──────┬────────┘
                       │      │      │
            ┌──────────▼┐  ┌──▼───┐  ┌▼──────────┐
            │ Zustand    │  │ Fire-│  │  IBKR     │
            │ Store      │  │ base │  │  Proxy    │
            │ (local     │  │ Auth │  │  (GCP VM) │
            │  state +   │  │  +   │  │           │
            │  persist)  │  │ Fire-│  │  Express  │
            └────────────┘  │ store│  │  CORS     │
                            └──────┘  └─────┬─────┘
                                            │
                                   ┌────────▼────────┐
                                   │  IBKR Gateway   │
                                   │  (Client Portal │
                                   │   API / Docker) │
                                   └─────────────────┘
```

### State Management

- **Zustand Store** (`useStore.ts`): Main app state — positions, trades, portfolio, rules, alerts. Persisted to `localStorage` via middleware.
- **Swing Store** (`useSwingStore.ts`): Separate store for swing trading state.
- **Firestore Sync** (`firestoreSync.ts`): Syncs trading data to Firestore for multi-device access. Each user's data is isolated under `userData/{userId}`.
- **Auth Context** (`AuthContext.tsx`): Firebase Auth state provided via React Context.

### Authentication & Security

- **Firebase Auth**: Email/password authentication
- **Firestore Rules**: Users can only read/write their own documents (`request.auth.uid == userId`)
- **IBKR Proxy**: API key validation via `X-API-Key` header
- **CORS**: Whitelisted origins on the proxy server
- **Environment Variables**: Firebase config loaded from `.env` via Vite's `import.meta.env`

---

## Key Features

### 1. Backtesting Engine (`services/backtester.ts`)

Strategies available:
- **Opening Range Breakout (ORB)**: Buy when price breaks above yesterday's high
- **RSI-based**: Entry/exit on RSI oversold/overbought levels
- **Candlestick Patterns**: 9 patterns (hammer, engulfing, doji, etc.)
- **Hybrid**: Combines multiple signals

Key design decisions:
- **No lookahead bias**: Only uses data available at entry time
- **Realistic haircut system**: Adjusts raw results by -40% to -50% for real-world factors
- **174,000+ days** of pre-downloaded price data (no API rate limits during backtests)

### 2. Paper Trading

- Full portfolio simulation with real-time quotes
- Long and short positions
- Take-profit and stop-loss automation
- Portfolio history tracking with equity curve
- Trade journal with emotional state tracking

### 3. Swing Trading (`services/swingTrader.ts`)

- **Market Regime Detection**: Classifies conditions as uptrend, downtrend, or sideways using SMA + ADX
- **Adaptive Strategies**: Different entry/exit rules per regime
- **Entry Signals**: RSI, SMA crossover, MACD, Bollinger Bands
- **Exit Rules**: Fixed targets, stop-loss, trailing stops, time-based exits

### 4. Auto-Trading (`services/autoTrader.ts`)

- Rule-based trade execution with configurable conditions
- Pattern recognition alerts
- Risk filters (RSI, volume, confidence thresholds)
- Cooldown system to prevent over-trading
- All auto-trades can be reviewed before execution

### 5. Interactive Brokers Integration (`services/ibkr.ts`)

- Live account data (positions, cash, buying power)
- Market/limit order placement
- Session keep-alive (every 50 seconds)
- Requires CORS proxy running on Google Cloud VM

### 6. Risk Management

- **PDT Compliance**: Enforces $25,000 minimum
- **Yearly Drawdown Protection**: Stops trading at -15% from year start
- **Position Scaling**: Reduces size above $100k portfolio
- **$500k Auto-Stop**: Halts day trading when goal reached

---

## Infrastructure

### Firebase Hosting

- Serves the `dist/` directory as a single-page app
- All routes rewrite to `/index.html`
- Long-term immutable caching for JS/CSS/images
- Config: `firebase.json`

### IBKR Proxy Server

- Express.js CORS proxy running on Google Cloud VM
- Bridges the web app to IBKR Gateway (which only allows localhost connections)
- Docker containerized with systemd service for auto-restart
- Setup script: `server/setup-vm.sh`
- Health check: `GET /health`

### Firestore Database

Two collections:
- `users/{userId}` — User profile and IBKR settings
- `userData/{userId}` — Trading data (positions, trades, rules)

Security rules enforce per-user isolation (see `firestore.rules`).

---

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting

# Deploy Firestore rules
firebase deploy --only firestore:rules

# Update historical data
npx tsx scripts/downloadHistoricalData.ts
```

### Environment Variables

Create a `.env` file in the project root:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

---

## Future Plans

- **Options Trading**: Wheel strategy implementation (see `docs/OPTIONS_TRADING_PLAN.md`)
- **Extended IBKR API**: Options chains, greeks, options order placement
- **More Data Providers**: Additional historical data sources
