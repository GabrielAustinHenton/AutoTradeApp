import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { TradingRule, RuleCondition, RuleAction, CandlestickPattern } from '../types';
import { PATTERN_INFO } from '../services/candlestickPatterns';

function formatTimeAgo(date: Date | undefined): string {
  if (!date) return 'Never';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function Rules() {
  const { tradingRules, addTradingRule, toggleTradingRule, removeTradingRule, updateTradingRule, autoTradeConfig } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [ruleType, setRuleType] = useState<'price' | 'pattern'>('pattern');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('AAPL');
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');

  // Pattern rule state
  const [selectedPattern, setSelectedPattern] = useState<CandlestickPattern>('hammer');

  // Price rule state
  const [conditionField, setConditionField] = useState<RuleCondition['field']>('price');
  const [conditionOperator, setConditionOperator] = useState<RuleCondition['operator']>('lt');
  const [conditionValue, setConditionValue] = useState('');

  // Action state
  const [actionType, setActionType] = useState<'market' | 'limit'>('market');
  const [actionShares, setActionShares] = useState('10');

  // Auto-trade state
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [cooldownMinutes, setCooldownMinutes] = useState('5');
  const [takeProfitPercent, setTakeProfitPercent] = useState('');
  const [stopLossPercent, setStopLossPercent] = useState('');
  const [trailingStopPercent, setTrailingStopPercent] = useState('');
  // RSI filter state
  const [rsiFilterEnabled, setRsiFilterEnabled] = useState(false);
  const [rsiMin, setRsiMin] = useState('');
  const [rsiMax, setRsiMax] = useState('');
  // Minimum confidence threshold
  const [minConfidence, setMinConfidence] = useState('70');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const action: RuleAction = {
      type: actionType,
      shares: parseInt(actionShares),
    };

    if (ruleType === 'pattern') {
      const rule: TradingRule = {
        id: crypto.randomUUID(),
        name: name || `${PATTERN_INFO[selectedPattern].name} - ${tradeType === 'buy' ? 'Buy' : 'Sell'} Signal`,
        symbol: symbol.toUpperCase(),
        enabled: true,
        type: tradeType,
        ruleType: 'pattern',
        pattern: selectedPattern,
        action,
        createdAt: new Date(),
        autoTrade: autoTradeEnabled,
        cooldownMinutes: parseInt(cooldownMinutes) || 5,
        takeProfitPercent: takeProfitPercent ? parseFloat(takeProfitPercent) : undefined,
        stopLossPercent: stopLossPercent ? parseFloat(stopLossPercent) : undefined,
        trailingStopPercent: trailingStopPercent ? parseFloat(trailingStopPercent) : undefined,
        rsiFilter: rsiFilterEnabled ? {
          enabled: true,
          period: 14,
          minRSI: rsiMin ? parseFloat(rsiMin) : undefined,
          maxRSI: rsiMax ? parseFloat(rsiMax) : undefined,
        } : undefined,
        minConfidence: minConfidence ? parseInt(minConfidence) : undefined,
      };
      addTradingRule(rule);
    } else {
      const condition: RuleCondition = {
        field: conditionField,
        operator: conditionOperator,
        value: parseFloat(conditionValue),
      };

      const rule: TradingRule = {
        id: crypto.randomUUID(),
        name: name || `${symbol.toUpperCase()} Price Rule`,
        symbol: symbol.toUpperCase(),
        enabled: true,
        type: tradeType,
        ruleType: 'price',
        conditions: [condition],
        action,
        createdAt: new Date(),
        autoTrade: autoTradeEnabled,
        cooldownMinutes: parseInt(cooldownMinutes) || 5,
        takeProfitPercent: takeProfitPercent ? parseFloat(takeProfitPercent) : undefined,
        stopLossPercent: stopLossPercent ? parseFloat(stopLossPercent) : undefined,
        trailingStopPercent: trailingStopPercent ? parseFloat(trailingStopPercent) : undefined,
        rsiFilter: rsiFilterEnabled ? {
          enabled: true,
          period: 14,
          minRSI: rsiMin ? parseFloat(rsiMin) : undefined,
          maxRSI: rsiMax ? parseFloat(rsiMax) : undefined,
        } : undefined,
      };
      addTradingRule(rule);
    }

    setShowForm(false);
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setSymbol('AAPL');
    setTradeType('buy');
    setSelectedPattern('hammer');
    setConditionField('price');
    setConditionOperator('lt');
    setConditionValue('');
    setActionType('market');
    setActionShares('10');
    setAutoTradeEnabled(false);
    setCooldownMinutes('5');
    setTakeProfitPercent('');
    setStopLossPercent('');
  };

  const getConditionText = (condition: RuleCondition) => {
    const operators: Record<string, string> = {
      gt: '>',
      lt: '<',
      eq: '=',
      gte: '>=',
      lte: '<=',
    };
    return `${condition.field} ${operators[condition.operator]} ${condition.value}`;
  };

  const patternRules = tradingRules.filter((r) => r.ruleType === 'pattern');
  const priceRules = tradingRules.filter((r) => r.ruleType === 'price');

  return (
    <div className="text-white">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Trading Rules</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg font-semibold transition-colors"
        >
          {showForm ? 'Cancel' : '+ New Rule'}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-800 rounded-xl p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Create Trading Rule</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Rule Type Selection */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Rule Type</label>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setRuleType('pattern')}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                    ruleType === 'pattern'
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  Candlestick Pattern
                </button>
                <button
                  type="button"
                  onClick={() => setRuleType('price')}
                  className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                    ruleType === 'price'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  Price Condition
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Rule Name (optional)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Auto-generated if empty"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Symbol</label>
                <input
                  type="text"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="AAPL"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
            </div>

            {/* Buy/Sell Selection */}
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setTradeType('buy')}
                className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                  tradeType === 'buy'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                Buy Rule
              </button>
              <button
                type="button"
                onClick={() => setTradeType('sell')}
                className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                  tradeType === 'sell'
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-700 text-slate-300'
                }`}
              >
                Sell Rule
              </button>
            </div>

            {/* Pattern Selection */}
            {ruleType === 'pattern' && (
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="font-semibold mb-3">Select Pattern</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {(Object.keys(PATTERN_INFO) as CandlestickPattern[]).map((pattern) => (
                    <button
                      key={pattern}
                      type="button"
                      onClick={() => setSelectedPattern(pattern)}
                      className={`p-3 rounded-lg text-left transition-colors ${
                        selectedPattern === pattern
                          ? 'bg-purple-600 text-white'
                          : 'bg-slate-600 hover:bg-slate-500'
                      }`}
                    >
                      <div className="font-semibold text-sm">{PATTERN_INFO[pattern].name}</div>
                      <div className={`text-xs ${
                        selectedPattern === pattern ? 'text-purple-200' : 'text-slate-400'
                      }`}>
                        {PATTERN_INFO[pattern].signal === 'buy' ? '↑ Bullish' : '↓ Bearish'}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-sm text-slate-400">
                  {PATTERN_INFO[selectedPattern].description}
                </p>
              </div>
            )}

            {/* Price Condition */}
            {ruleType === 'price' && (
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="font-semibold mb-3">Condition</h3>
                <div className="grid grid-cols-3 gap-4">
                  <select
                    value={conditionField}
                    onChange={(e) => setConditionField(e.target.value as RuleCondition['field'])}
                    className="bg-slate-600 border border-slate-500 rounded-lg px-4 py-2"
                  >
                    <option value="price">Price</option>
                    <option value="change">Change ($)</option>
                    <option value="changePercent">Change (%)</option>
                    <option value="volume">Volume</option>
                  </select>
                  <select
                    value={conditionOperator}
                    onChange={(e) => setConditionOperator(e.target.value as RuleCondition['operator'])}
                    className="bg-slate-600 border border-slate-500 rounded-lg px-4 py-2"
                  >
                    <option value="lt">Less than</option>
                    <option value="lte">Less or equal</option>
                    <option value="eq">Equal to</option>
                    <option value="gte">Greater or equal</option>
                    <option value="gt">Greater than</option>
                  </select>
                  <input
                    type="number"
                    value={conditionValue}
                    onChange={(e) => setConditionValue(e.target.value)}
                    placeholder="150"
                    step="0.01"
                    className="bg-slate-600 border border-slate-500 rounded-lg px-4 py-2"
                    required={ruleType === 'price'}
                  />
                </div>
              </div>
            )}

            {/* Action */}
            <div className="bg-slate-700 rounded-lg p-4">
              <h3 className="font-semibold mb-3">Action</h3>
              <div className="grid grid-cols-2 gap-4">
                <select
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value as 'market' | 'limit')}
                  className="bg-slate-600 border border-slate-500 rounded-lg px-4 py-2"
                >
                  <option value="market">Market Order</option>
                  <option value="limit">Limit Order</option>
                </select>
                <input
                  type="number"
                  value={actionShares}
                  onChange={(e) => setActionShares(e.target.value)}
                  placeholder="Shares"
                  min="1"
                  className="bg-slate-600 border border-slate-500 rounded-lg px-4 py-2"
                  required
                />
              </div>
            </div>

            {/* Auto-Trade Settings */}
            <div className="bg-slate-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Auto-Trade</h3>
                <button
                  type="button"
                  onClick={() => setAutoTradeEnabled(!autoTradeEnabled)}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    autoTradeEnabled
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-slate-600 hover:bg-slate-500'
                  }`}
                >
                  {autoTradeEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
              {autoTradeEnabled && (
                <>
                  <p className="text-sm text-amber-400 mb-3">
                    Trades will execute automatically when this pattern is detected.
                  </p>
                  <div className="flex items-center gap-3 mb-3">
                    <label className="text-sm text-slate-400">Cooldown:</label>
                    <input
                      type="number"
                      value={cooldownMinutes}
                      onChange={(e) => setCooldownMinutes(e.target.value)}
                      min="1"
                      className="w-20 bg-slate-600 border border-slate-500 rounded-lg px-3 py-1 text-center"
                    />
                    <span className="text-sm text-slate-400">minutes between trades</span>
                  </div>

                  {/* Take Profit / Stop Loss for BUY rules */}
                  {tradeType === 'buy' && (
                    <>
                    <div className="mt-4 p-3 bg-slate-800 rounded-lg">
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Auto-Sell Targets (optional)</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs text-emerald-400 mb-1 block">Take Profit %</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={takeProfitPercent}
                              onChange={(e) => setTakeProfitPercent(e.target.value)}
                              placeholder="5"
                              step="0.5"
                              min="0.1"
                              className="w-full bg-slate-600 border border-slate-500 rounded-lg px-3 py-2 text-center"
                            />
                            <span className="text-slate-400">%</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">Auto-sell when up this %</p>
                        </div>
                        <div>
                          <label className="text-xs text-red-400 mb-1 block">Stop Loss %</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={stopLossPercent}
                              onChange={(e) => setStopLossPercent(e.target.value)}
                              placeholder="3"
                              step="0.5"
                              min="0.1"
                              className="w-full bg-slate-600 border border-slate-500 rounded-lg px-3 py-2 text-center"
                            />
                            <span className="text-slate-400">%</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">Auto-sell when down this %</p>
                        </div>
                        <div>
                          <label className="text-xs text-blue-400 mb-1 block">Trailing Stop %</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={trailingStopPercent}
                              onChange={(e) => setTrailingStopPercent(e.target.value)}
                              placeholder="5"
                              step="0.5"
                              min="0.1"
                              className="w-full bg-slate-600 border border-slate-500 rounded-lg px-3 py-2 text-center"
                            />
                            <span className="text-slate-400">%</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">Trail this % below highest price</p>
                        </div>
                      </div>
                    </div>

                    {/* RSI Filter */}
                    <div className="mt-4 p-3 bg-slate-700/50 rounded-lg">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rsiFilterEnabled}
                          onChange={(e) => setRsiFilterEnabled(e.target.checked)}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm font-medium">RSI Filter</span>
                        <span className="text-xs text-slate-400">(only trade when RSI meets criteria)</span>
                      </label>
                      {rsiFilterEnabled && (
                        <div className="mt-3 grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-xs text-emerald-400 mb-1 block">Min RSI (oversold)</label>
                            <input
                              type="number"
                              value={rsiMin}
                              onChange={(e) => setRsiMin(e.target.value)}
                              placeholder="30"
                              min="0"
                              max="100"
                              className="w-full bg-slate-600 border border-slate-500 rounded-lg px-3 py-2 text-center"
                            />
                            <p className="text-xs text-slate-500 mt-1">Buy when RSI &gt;= this</p>
                          </div>
                          <div>
                            <label className="text-xs text-red-400 mb-1 block">Max RSI (overbought)</label>
                            <input
                              type="number"
                              value={rsiMax}
                              onChange={(e) => setRsiMax(e.target.value)}
                              placeholder="70"
                              min="0"
                              max="100"
                              className="w-full bg-slate-600 border border-slate-500 rounded-lg px-3 py-2 text-center"
                            />
                            <p className="text-xs text-slate-500 mt-1">Sell when RSI &lt;= this</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Minimum Confidence Threshold */}
                    <div className="mt-4 p-3 bg-slate-700/50 rounded-lg">
                      <label className="text-sm font-medium text-amber-400 mb-2 block">
                        Minimum Confidence Threshold
                      </label>
                      <div className="flex items-center gap-4">
                        <input
                          type="range"
                          value={minConfidence}
                          onChange={(e) => setMinConfidence(e.target.value)}
                          min="0"
                          max="100"
                          step="5"
                          className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex items-center gap-1 min-w-[60px]">
                          <input
                            type="number"
                            value={minConfidence}
                            onChange={(e) => setMinConfidence(e.target.value)}
                            min="0"
                            max="100"
                            className="w-14 bg-slate-600 border border-slate-500 rounded px-2 py-1 text-center text-sm"
                          />
                          <span className="text-slate-400">%</span>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 mt-2">
                        Only execute trades when pattern confidence is at least this value. Higher = fewer but more reliable trades.
                      </p>
                    </div>
                    </>
                  )}

                  {!autoTradeConfig.enabled && (
                    <p className="text-sm text-red-400 mt-2">
                      Note: Global auto-trading is disabled. Enable it in Settings.
                    </p>
                  )}
                </>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 py-3 rounded-lg font-semibold transition-colors"
            >
              Create Rule
            </button>
          </form>
        </div>
      )}

      {/* Candlestick Pattern Rules */}
      <div className="bg-slate-800 rounded-xl p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <span className="text-purple-400">◆</span> Candlestick Pattern Rules
        </h2>
        {patternRules.length === 0 ? (
          <p className="text-slate-400">No candlestick pattern rules configured.</p>
        ) : (
          <div className="space-y-3">
            {patternRules.map((rule) => (
              <div
                key={rule.id}
                className={`p-4 rounded-lg border ${
                  rule.enabled
                    ? 'bg-slate-700 border-slate-600'
                    : 'bg-slate-800 border-slate-700 opacity-60'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{rule.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-600 text-slate-300">
                        {rule.symbol}
                      </span>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          rule.type === 'buy'
                            ? 'bg-emerald-900 text-emerald-300'
                            : 'bg-red-900 text-red-300'
                        }`}
                      >
                        {rule.type.toUpperCase()}
                      </span>
                      {rule.autoTrade && (
                        <span className="text-xs px-2 py-1 rounded bg-amber-900 text-amber-300">
                          AUTO
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                      When <span className="text-purple-400 font-medium">{rule.pattern && PATTERN_INFO[rule.pattern]?.name}</span> pattern detected
                    </p>
                    <p className="text-sm text-slate-400">
                      → {rule.action.type} order for {rule.action.shares} shares
                    </p>
                    {rule.autoTrade && (
                      <p className="text-xs text-slate-500 mt-1">
                        Cooldown: {rule.cooldownMinutes}min • Last executed: {formatTimeAgo(rule.lastExecutedAt)}
                        {(rule.takeProfitPercent || rule.stopLossPercent || rule.trailingStopPercent || rule.rsiFilter?.enabled || rule.minConfidence) && (
                          <span className="ml-2">
                            {rule.takeProfitPercent && <span className="text-emerald-400">TP: {rule.takeProfitPercent}%</span>}
                            {rule.takeProfitPercent && (rule.stopLossPercent || rule.trailingStopPercent) && ' • '}
                            {rule.stopLossPercent && <span className="text-red-400">SL: {rule.stopLossPercent}%</span>}
                            {rule.stopLossPercent && rule.trailingStopPercent && ' • '}
                            {rule.trailingStopPercent && <span className="text-blue-400">Trail: {rule.trailingStopPercent}%</span>}
                            {rule.rsiFilter?.enabled && (
                              <span className="text-purple-400 ml-2">
                                RSI: {rule.rsiFilter.minRSI !== undefined && `≥${rule.rsiFilter.minRSI}`}
                                {rule.rsiFilter.minRSI !== undefined && rule.rsiFilter.maxRSI !== undefined && ' & '}
                                {rule.rsiFilter.maxRSI !== undefined && `≤${rule.rsiFilter.maxRSI}`}
                              </span>
                            )}
                            {rule.minConfidence && (
                              <span className="text-amber-400 ml-2">
                                Min Conf: {rule.minConfidence}%
                              </span>
                            )}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateTradingRule(rule.id, { autoTrade: !rule.autoTrade })}
                      className={`px-3 py-1 rounded text-sm ${
                        rule.autoTrade
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : 'bg-slate-600 hover:bg-slate-500'
                      }`}
                      title={rule.autoTrade ? 'Disable auto-trade' : 'Enable auto-trade'}
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => toggleTradingRule(rule.id)}
                      className={`px-3 py-1 rounded text-sm ${
                        rule.enabled
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-slate-600 hover:bg-slate-500'
                      }`}
                    >
                      {rule.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    <button
                      onClick={() => removeTradingRule(rule.id)}
                      className="text-red-400 hover:text-red-300 px-2"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Price-Based Rules */}
      <div className="bg-slate-800 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <span className="text-blue-400">●</span> Price-Based Rules
        </h2>
        {priceRules.length === 0 ? (
          <p className="text-slate-400">No price-based rules configured.</p>
        ) : (
          <div className="space-y-3">
            {priceRules.map((rule) => (
              <div
                key={rule.id}
                className={`p-4 rounded-lg border ${
                  rule.enabled
                    ? 'bg-slate-700 border-slate-600'
                    : 'bg-slate-800 border-slate-700 opacity-60'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{rule.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-600 text-slate-300">
                        {rule.symbol}
                      </span>
                      <span
                        className={`text-xs px-2 py-1 rounded ${
                          rule.type === 'buy'
                            ? 'bg-emerald-900 text-emerald-300'
                            : 'bg-red-900 text-red-300'
                        }`}
                      >
                        {rule.type.toUpperCase()}
                      </span>
                      {rule.autoTrade && (
                        <span className="text-xs px-2 py-1 rounded bg-amber-900 text-amber-300">
                          AUTO
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                      When {rule.conditions?.map(getConditionText).join(' AND ')}
                    </p>
                    <p className="text-sm text-slate-400">
                      → {rule.action.type} order for {rule.action.shares} shares
                    </p>
                    {rule.autoTrade && (
                      <p className="text-xs text-slate-500 mt-1">
                        Cooldown: {rule.cooldownMinutes}min • Last executed: {formatTimeAgo(rule.lastExecutedAt)}
                        {(rule.takeProfitPercent || rule.stopLossPercent || rule.trailingStopPercent || rule.rsiFilter?.enabled || rule.minConfidence) && (
                          <span className="ml-2">
                            {rule.takeProfitPercent && <span className="text-emerald-400">TP: {rule.takeProfitPercent}%</span>}
                            {rule.takeProfitPercent && (rule.stopLossPercent || rule.trailingStopPercent) && ' • '}
                            {rule.stopLossPercent && <span className="text-red-400">SL: {rule.stopLossPercent}%</span>}
                            {rule.stopLossPercent && rule.trailingStopPercent && ' • '}
                            {rule.trailingStopPercent && <span className="text-blue-400">Trail: {rule.trailingStopPercent}%</span>}
                            {rule.rsiFilter?.enabled && (
                              <span className="text-purple-400 ml-2">
                                RSI: {rule.rsiFilter.minRSI !== undefined && `≥${rule.rsiFilter.minRSI}`}
                                {rule.rsiFilter.minRSI !== undefined && rule.rsiFilter.maxRSI !== undefined && ' & '}
                                {rule.rsiFilter.maxRSI !== undefined && `≤${rule.rsiFilter.maxRSI}`}
                              </span>
                            )}
                            {rule.minConfidence && (
                              <span className="text-amber-400 ml-2">
                                Min Conf: {rule.minConfidence}%
                              </span>
                            )}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateTradingRule(rule.id, { autoTrade: !rule.autoTrade })}
                      className={`px-3 py-1 rounded text-sm ${
                        rule.autoTrade
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : 'bg-slate-600 hover:bg-slate-500'
                      }`}
                      title={rule.autoTrade ? 'Disable auto-trade' : 'Enable auto-trade'}
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => toggleTradingRule(rule.id)}
                      className={`px-3 py-1 rounded text-sm ${
                        rule.enabled
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : 'bg-slate-600 hover:bg-slate-500'
                      }`}
                    >
                      {rule.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    <button
                      onClick={() => removeTradingRule(rule.id)}
                      className="text-red-400 hover:text-red-300 px-2"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
