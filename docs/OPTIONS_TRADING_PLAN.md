# Options Trading Implementation Plan

## The Wheel Strategy

Based on research from [Option Alpha](https://optionalpha.com/blog/wheel-strategy) and [Alpaca](https://github.com/alpacahq/options-wheel).

### How It Works

1. **Sell cash-secured puts** on stocks you want to own
   - Collect premium upfront
   - If stock stays above strike → keep premium, repeat
   - If stock drops below strike → assigned 100 shares

2. **If assigned, sell covered calls** against your shares
   - Collect more premium
   - If stock stays below strike → keep premium, repeat
   - If stock rises above strike → shares called away, profit

3. **Cycle repeats** - hence "wheel"

### Best Practices

- **Stock selection**: Pick stocks you'd want to own long-term
- **Strike selection**:
  - Puts: Below current price (e.g., 0.3 delta)
  - Calls: Above your cost basis
- **Expiration**: 30-45 days out (optimal theta decay)
- **IV**: Sell when implied volatility is high
- **Position sizing**: 1-2 positions per $10k capital

### Risk Management

- Set 10% stop loss if stock crashes after assignment
- Don't chase premium on risky stocks
- Diversify across sectors
- Keep 20% cash reserve

### Implementation Requirements

1. **IBKR API additions needed:**
   - Get options chain for symbol
   - Calculate greeks (delta, theta)
   - Place options orders (sell to open, buy to close)
   - Handle assignment notifications

2. **New UI components:**
   - Options chain viewer
   - Wheel position tracker
   - Premium income dashboard

3. **Auto-trading logic:**
   - Select optimal strikes based on delta
   - Roll positions before expiration
   - Handle assignment automatically

### Resources

- [Alpaca Wheel Bot (Python)](https://github.com/alpacahq/options-wheel)
- [QuantConnect Wheel Strategy](https://www.quantconnect.com/research/17871/automating-the-wheel-strategy/)
- [Options Trading IQ Guide](https://optionstradingiq.com/the-wheel-strategy/)

### Capital Requirements

- Minimum ~$5,000 per position (100 shares of $50 stock)
- Recommended: $20,000+ for diversification across 3-4 positions
