# AutoTradeApp Redesign Plan

## Vision
A clean, focused auto-trading app for the ORB (Opening Range Breakout) day trading strategy.
Set it up, connect Alpaca, and let it grow your money. Two pages. One purpose.

---

## PHASE 1: Delete Swing Trading (everything)

### Files to DELETE:
- `src/pages/SwingTrader.tsx` — Swing trader UI page
- `src/store/useSwingStore.ts` — Swing-specific Zustand store
- `src/services/swingTrader.ts` — Swing trading engine (regime detection, strategies)
- `src/services/swingScanner.ts` — Swing signal detection
- `src/hooks/useSwingScanner.ts` — React hook for swing scanning
- `scripts/swing-cron.ts` — Swing scanner GitHub Actions script
- `.github/workflows/swing-scanner.yml` — Swing scanner workflow
- `config/swing-watchlist.json` — Swing watchlist

### Types to remove from `src/types/index.ts`:
- MarketRegime, SwingTraderConfig, RegimeDetectionConfig, SwingStrategyConfig
- SwingEntryRule, SwingExitRule, SwingTrade, SwingEquitySnapshot
- SwingTraderState, SwingTradePosition
- CryptoPosition, CryptoTradingRule, CryptoTrade, CryptoPortfolio (dead code)
- CryptoAutoTradeConfig, CryptoBacktestConfig/Result/Trade (dead code)
- DCAConfig, GridConfig (dead code)

### References to clean up:
- Remove SwingTrader route from `App.tsx`
- Remove swing link from `Sidebar.tsx` and `MobileNav.tsx`
- Remove swing import from `Backtest.tsx` (if kept)
- Remove swing credential methods from `alpaca.ts` (configureSwingTrader, swingRequest, etc.)
- Remove swing-related code from `Settings.tsx`

---

## PHASE 2: Delete Unnecessary Pages

### Pages to DELETE:
- `src/pages/Portfolio.tsx` — Redundant with Dashboard (auto-trader manages portfolio)
- `src/pages/Trade.tsx` — Manual trading not needed (it's auto)
- `src/pages/Trade.test.tsx` — Test for deleted page
- `src/pages/Portfolio.test.tsx` — Test for deleted page
- `src/pages/Charts.tsx` — Not needed for auto-trading
- `src/pages/Rules.tsx` — Trading rules baked into ORB strategy, not user-editable
- `src/pages/Journal.tsx` — Not needed for auto-trading
- `src/pages/Backtest.tsx` — Keep backtest LOGIC in services, remove the page

### Pages to KEEP (redesigned):
1. **Dashboard** — The single main view
2. **Trade History** — Past trades list (simplified)
3. **Settings** — Alpaca connection + risk config
4. **Auth** — Login (unchanged)

---

## PHASE 3: PDT (Pattern Day Trader) Protection

### Logic:
- Alpaca API provides `daytrade_count` and `pattern_day_trader` on the account object
- Under $25k equity: max 3 day trades per 5 rolling business days
- Over $25k: no PDT restriction, but enforce risk limits

### Implementation:
- Add `pdtProtection` to store state:
  ```
  pdtStatus: {
    equity: number
    isAbovePDT: boolean        // equity >= $25,000
    dayTradeCount: number      // from Alpaca API (rolling 5-day)
    dayTradesRemaining: number // 3 - dayTradeCount (when under $25k)
    tradingPaused: boolean     // true when 0 trades remaining
  }
  ```
- ORB scanner checks `dayTradesRemaining` before placing orders
- Dashboard shows PDT status prominently when under $25k
- When `dayTradesRemaining === 0`, auto-trading pauses with clear message

### Risk management (over $25k):
- Max daily exposure cap (configurable, default 30% of portfolio)
- Max trades per day (configurable, default 20)
- Yearly drawdown protection (existing: stops if down 15% from year start)
- Per-trade max (configurable, default 15% of portfolio)

---

## PHASE 4: Market Regime Detection (Bull/Bear)

### Logic:
- Use SPY as market proxy
- Bull market: SPY price > 200-day SMA → trading enabled
- Bear market: SPY price < 200-day SMA → trading paused
- Check daily on each scan cycle

### Implementation:
- Add to ORB scanner (both cron script and in-app):
  ```
  async function isMarketBullish(): Promise<boolean> {
    // Fetch SPY daily bars (200+ days)
    // Calculate 200-day SMA
    // Return current price > SMA200
  }
  ```
- Dashboard shows market regime indicator (green/red)
- When bearish: auto-trading pauses, clear message shown
- User can override in Settings (force-enable in bear market)

---

## PHASE 5: New Dashboard Design

### Layout (single page, everything visible):

```
┌─────────────────────────────────────────────┐
│  AutoTrader                    [PAPER] [⚙️]  │
├─────────────────────────────────────────────┤
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │Portfolio  │ │Day P&L   │ │Buying    │    │
│  │$99,034   │ │-$82.09   │ │Power     │    │
│  │          │ │          │ │$375,612  │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                             │
│  ┌─── Status ───────────────────────────┐   │
│  │ Auto-Trading: ● ON                   │   │
│  │ Market: 🟢 Bullish (SPY > 200 SMA)   │   │
│  │ PDT: ✓ Above $25k — unlimited trades │   │
│  │ Today: 3 trades placed, 2 wins       │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌─── Performance Chart ────────────────┐   │
│  │ [line chart of portfolio value]       │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌─── Open Positions ──────────────────┐    │
│  │ UBER  49 shares  +$3.19   +0.09%   │    │
│  │ QQQ    6 shares  -$16.62  -0.46%   │    │
│  │ ...                                 │    │
│  └──────────────────────────────────────┘   │
│                                             │
│  ┌─── Recent Trades ──────────────────┐     │
│  │ Today 10:14  NVDA BUY  5 @ $142.30 │     │
│  │ Today 10:45  NVDA SELL 5 @ $145.14 │     │
│  │ [View All →]                        │     │
│  └─────────────────────────────────────┘     │
│                                             │
│  ┌─── Watchlist ───────────────────────┐    │
│  │ NVDA TSLA AAPL META MSFT ...       │    │
│  │ [Edit in Settings]                  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### Design principles:
- Dark theme (slate-950 background, existing Tailwind palette)
- Cards with subtle borders, no clutter
- Status section is the hero — tells you everything at a glance
- Green/red color coding for P&L
- Mobile-first responsive
- No manual trade buttons — it's an auto-trader

---

## PHASE 6: Simplified Settings

### Sections:
1. **Alpaca Connection** (paper/live, API keys)
2. **Trading Mode** (paper/live toggle)
3. **Auto-Trading** (on/off master switch)
4. **Risk Controls**:
   - Max daily exposure (% of portfolio)
   - Max trades per day
   - Yearly drawdown limit (%)
   - Bear market override (force-trade in downtrend)
5. **Watchlist** (add/remove symbols)
6. **Account** (Firebase auth, sign out)

### Remove from Settings:
- Swing trader credentials
- GitHub PAT (ORB scanner runs via GitHub Actions, not user-controlled)
- Sound notifications (auto-trader doesn't need alerts)
- Pattern notification toggles
- Manual trading rules management

---

## PHASE 7: Cleanup

### Files to simplify/clean:
- `useStore.ts` — Remove swing references, short selling, manual trade actions
- `alpaca.ts` — Remove all swing trader methods
- `types/index.ts` — Remove all swing/crypto/dead types
- `Sidebar.tsx` / `MobileNav.tsx` — Only Dashboard, History, Settings links
- `App.tsx` — Only 3 routes + Auth

### Services to KEEP:
- `alpaca.ts` (core trading API)
- `orbScanner.ts` (ORB strategy — the money maker)
- `autoTrader.ts` (execution engine)
- `positionMonitor.ts` (TP/SL monitoring)
- `backtester.ts` (keep ORB backtest logic, remove swing/pattern backtests)
- `firestoreSync.ts` (cloud persistence)
- `alphaVantage.ts` (data fallback)
- `historicalDataCache.ts` (performance)

### Services to DELETE:
- `swingTrader.ts`
- `swingScanner.ts`
- `candlestickPatterns.ts` (ORB doesn't use candlestick patterns)
- `sounds.ts` (auto-trader doesn't need sound alerts)
- `binanceApi.ts` (no crypto trading)

### Bug to FIX:
- `useStore.ts` line ~1142: Auto-trade toggle incorrectly modifies all rules' enabled state

---

## What stays UNTOUCHED:
- ORB scanner logic (scripts/orb-cron.ts)
- ORB EOD close (scripts/orb-eod-close.ts)
- ORB GitHub Actions workflows (orb-scanner.yml, orb-eod-close.yml)
- Day trading backtest logic in backtester.ts
- Firebase auth system
- Firestore sync
- Deploy workflow

---

## Order of execution:
1. Delete swing files + references
2. Delete unnecessary pages + references
3. Add PDT protection to store + ORB scanner
4. Add market regime detection
5. Redesign Dashboard (new single-focus layout)
6. Simplify Settings
7. Clean up navigation (Sidebar, MobileNav)
8. Clean up store, types, services
9. Fix the auto-trade toggle bug
10. Build + test
11. Commit + push
