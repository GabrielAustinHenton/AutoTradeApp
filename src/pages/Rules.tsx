import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { TradingRule, RuleCondition, CandlestickPattern } from '../types';
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
  const { tradingRules, addTradingRule, toggleTradingRule, removeTradingRule, resetTradingRules } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [ruleType, setRuleType] = useState<'price' | 'pattern' | 'macd'>('pattern');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tradeType, setTradeType] = useState<'buy' | 'sell' | 'short'>('buy');

  // Pattern rule state
  const [selectedPattern, setSelectedPattern] = useState<CandlestickPattern>('hammer');

  // Price rule state
  const [conditionField, setConditionField] = useState<RuleCondition['field']>('price');
  const [conditionOperator, setConditionOperator] = useState<RuleCondition['operator']>('lt');
  const [conditionValue, setConditionValue] = useState('');

  // MACD settings state
  const [macdFastPeriod, setMacdFastPeriod] = useState('12');
  const [macdSlowPeriod, setMacdSlowPeriod] = useState('26');
  const [macdSignalPeriod, setMacdSignalPeriod] = useState('9');
  const [macdCrossoverType, setMacdCrossoverType] = useState<'bullish' | 'bearish'>('bullish');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (ruleType === 'pattern') {
      const rule: TradingRule = {
        id: crypto.randomUUID(),
        name: name || `${PATTERN_INFO[selectedPattern].name} ${tradeType === 'buy' ? 'Buy' : tradeType === 'sell' ? 'Sell' : 'Short'} Signal`,
        symbol: symbol.trim().toUpperCase() || undefined,
        enabled: true,
        type: tradeType,
        ruleType: 'pattern',
        pattern: selectedPattern,
        action: { type: 'market' },
        createdAt: new Date(),
        autoTrade: false,
        cooldownMinutes: 5,
      };
      addTradingRule(rule);
    } else if (ruleType === 'macd') {
      const rule: TradingRule = {
        id: crypto.randomUUID(),
        name: name || `MACD ${macdCrossoverType === 'bullish' ? 'Bullish' : 'Bearish'} Signal`,
        symbol: symbol.trim().toUpperCase() || undefined,
        enabled: true,
        type: macdCrossoverType === 'bullish' ? 'buy' : 'sell',
        ruleType: 'macd',
        macdSettings: {
          fastPeriod: parseInt(macdFastPeriod) || 12,
          slowPeriod: parseInt(macdSlowPeriod) || 26,
          signalPeriod: parseInt(macdSignalPeriod) || 9,
          crossoverType: macdCrossoverType,
        },
        action: { type: 'market' },
        createdAt: new Date(),
        autoTrade: false,
        cooldownMinutes: 5,
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
        name: name || `Price Alert${symbol.trim() ? ` — ${symbol.trim().toUpperCase()}` : ''}`,
        symbol: symbol.trim().toUpperCase() || undefined,
        enabled: true,
        type: tradeType,
        ruleType: 'price',
        conditions: [condition],
        action: { type: 'market' },
        createdAt: new Date(),
        autoTrade: false,
        cooldownMinutes: 5,
      };
      addTradingRule(rule);
    }

    setShowForm(false);
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setSymbol('');
    setTradeType('buy');
    setSelectedPattern('hammer');
    setConditionField('price');
    setConditionOperator('lt');
    setConditionValue('');
    setMacdFastPeriod('12');
    setMacdSlowPeriod('26');
    setMacdSignalPeriod('9');
    setMacdCrossoverType('bullish');
  };

  const getConditionText = (condition: RuleCondition) => {
    const operators: Record<string, string> = { gt: '>', lt: '<', eq: '=', gte: '>=', lte: '<=' };
    return `${condition.field} ${operators[condition.operator]} ${condition.value}`;
  };

  const patternRules = tradingRules.filter((r) => r.ruleType === 'pattern');
  const macdRules = tradingRules.filter((r) => r.ruleType === 'macd');
  const priceRules = tradingRules.filter((r) => r.ruleType === 'price');

  return (
    <div className="text-white">
      <div className="flex justify-between items-center mb-6 md:mb-8">
        <div className="flex items-center gap-3">
          <Link to="/swing-trader" className="text-slate-400 hover:text-white text-sm flex items-center gap-1">
            &larr; SwingTrader
          </Link>
          <h1 className="text-2xl md:text-3xl font-bold">Trading Signals</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (confirm('Reset all trading signals back to defaults? This will remove any custom signals you added.')) {
                resetTradingRules();
              }
            }}
            className="text-slate-400 hover:text-slate-200 text-sm px-3 py-2 rounded-lg hover:bg-slate-700 transition-colors"
          >
            Reset to Defaults
          </button>
          <button
            onClick={() => { setShowForm(!showForm); if (showForm) resetForm(); }}
            className="bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-lg font-semibold transition-colors"
          >
            {showForm ? 'Cancel' : '+ New Signal'}
          </button>
        </div>
      </div>

      <p className="text-slate-400 text-sm mb-6">
        Signals generate alerts when patterns are detected on your watchlist. Auto-trading is handled by the ORB Scanner — enable it in Settings.
      </p>

      {showForm && (
        <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-6">
          <h2 className="text-lg md:text-xl font-semibold mb-4">Create Signal</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Signal Type */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">Signal Type</label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setRuleType('pattern')}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${ruleType === 'pattern' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  Candlestick Pattern
                </button>
                <button type="button" onClick={() => setRuleType('macd')}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${ruleType === 'macd' ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  MACD Crossover
                </button>
                <button type="button" onClick={() => setRuleType('price')}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${ruleType === 'price' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'}`}>
                  Price Condition
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Signal Name <span className="text-slate-500">(optional)</span></label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Auto-generated if empty"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Symbol <span className="text-slate-500">(optional — leave blank for any stock)</span></label>
                <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. AAPL"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-emerald-500" />
              </div>
            </div>

            {/* Direction — hidden for MACD since crossover type determines it */}
            {ruleType !== 'macd' && (
              <div>
                <label className="block text-sm text-slate-400 mb-2">Signal Direction</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setTradeType('buy')}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${tradeType === 'buy' ? 'bg-emerald-600' : 'bg-slate-700 text-slate-300'}`}>
                    Buy Signal
                  </button>
                  <button type="button" onClick={() => setTradeType('sell')}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${tradeType === 'sell' ? 'bg-red-600' : 'bg-slate-700 text-slate-300'}`}>
                    Sell Signal
                  </button>
                  <button type="button" onClick={() => setTradeType('short')}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${tradeType === 'short' ? 'bg-purple-600' : 'bg-slate-700 text-slate-300'}`}>
                    Short Signal
                  </button>
                </div>
              </div>
            )}

            {/* Pattern Selection */}
            {ruleType === 'pattern' && (
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="font-semibold text-sm mb-3">Select Pattern</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {(Object.keys(PATTERN_INFO) as CandlestickPattern[]).map((pattern) => (
                    <button key={pattern} type="button" onClick={() => setSelectedPattern(pattern)}
                      className={`p-2 rounded-lg text-left transition-colors ${selectedPattern === pattern ? 'bg-purple-600 text-white' : 'bg-slate-600 hover:bg-slate-500'}`}>
                      <div className="font-semibold text-sm">{PATTERN_INFO[pattern].name}</div>
                      <div className={`text-xs ${selectedPattern === pattern ? 'text-purple-200' : 'text-slate-400'}`}>
                        {PATTERN_INFO[pattern].signal === 'buy' ? '↑ Bullish' : '↓ Bearish'}
                      </div>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-sm text-slate-400">{PATTERN_INFO[selectedPattern].description}</p>
              </div>
            )}

            {/* MACD Settings */}
            {ruleType === 'macd' && (
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="font-semibold mb-3">MACD Settings</h3>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <button type="button" onClick={() => setMacdCrossoverType('bullish')}
                    className={`py-2 rounded-lg font-semibold transition-colors text-sm ${macdCrossoverType === 'bullish' ? 'bg-emerald-600' : 'bg-slate-600 text-slate-300'}`}>
                    Bullish Cross (Buy)
                  </button>
                  <button type="button" onClick={() => setMacdCrossoverType('bearish')}
                    className={`py-2 rounded-lg font-semibold transition-colors text-sm ${macdCrossoverType === 'bearish' ? 'bg-red-600' : 'bg-slate-600 text-slate-300'}`}>
                    Bearish Cross (Sell)
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Fast EMA', value: macdFastPeriod, set: setMacdFastPeriod, placeholder: '12' },
                    { label: 'Slow EMA', value: macdSlowPeriod, set: setMacdSlowPeriod, placeholder: '26' },
                    { label: 'Signal', value: macdSignalPeriod, set: setMacdSignalPeriod, placeholder: '9' },
                  ].map(({ label, value, set, placeholder }) => (
                    <div key={label}>
                      <label className="text-xs text-orange-400 mb-1 block">{label}</label>
                      <input type="number" value={value} onChange={(e) => set(e.target.value)}
                        placeholder={placeholder} min="2" max="100"
                        className="w-full bg-slate-600 border border-slate-500 rounded-lg px-3 py-2 text-center text-sm" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Price Condition */}
            {ruleType === 'price' && (
              <div className="bg-slate-700 rounded-lg p-4">
                <h3 className="font-semibold mb-3">Condition</h3>
                <div className="grid grid-cols-3 gap-3">
                  <select value={conditionField} onChange={(e) => setConditionField(e.target.value as RuleCondition['field'])}
                    className="bg-slate-600 border border-slate-500 rounded-lg px-3 py-2 text-sm">
                    <option value="price">Price</option>
                    <option value="change">Change ($)</option>
                    <option value="changePercent">Change (%)</option>
                    <option value="volume">Volume</option>
                  </select>
                  <select value={conditionOperator} onChange={(e) => setConditionOperator(e.target.value as RuleCondition['operator'])}
                    className="bg-slate-600 border border-slate-500 rounded-lg px-3 py-2 text-sm">
                    <option value="lt">Less than</option>
                    <option value="lte">Less or equal</option>
                    <option value="eq">Equal to</option>
                    <option value="gte">Greater or equal</option>
                    <option value="gt">Greater than</option>
                  </select>
                  <input type="number" value={conditionValue} onChange={(e) => setConditionValue(e.target.value)}
                    placeholder="150" step="0.01" required
                    className="bg-slate-600 border border-slate-500 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            )}

            <button type="submit"
              className="w-full bg-emerald-600 hover:bg-emerald-700 py-3 rounded-lg font-semibold transition-colors">
              Create Signal
            </button>
          </form>
        </div>
      )}

      {/* Pattern Rules */}
      <RuleSection
        title="Candlestick Patterns"
        color="text-purple-400"
        icon="◆"
        rules={patternRules}
        getDescription={(rule) => rule.pattern ? `When ${PATTERN_INFO[rule.pattern]?.name ?? rule.pattern} detected` : ''}
        onToggle={toggleTradingRule}
        onRemove={removeTradingRule}
        formatTimeAgo={formatTimeAgo}
      />

      <RuleSection
        title="MACD Crossovers"
        color="text-orange-400"
        icon="◈"
        rules={macdRules}
        getDescription={(rule) =>
          `When ${rule.macdSettings?.crossoverType === 'bullish' ? 'bullish' : 'bearish'} MACD crossover detected` +
          ` (${rule.macdSettings?.fastPeriod}/${rule.macdSettings?.slowPeriod}/${rule.macdSettings?.signalPeriod})`
        }
        onToggle={toggleTradingRule}
        onRemove={removeTradingRule}
        formatTimeAgo={formatTimeAgo}
      />

      <RuleSection
        title="Price Alerts"
        color="text-blue-400"
        icon="●"
        rules={priceRules}
        getDescription={(rule) => rule.conditions?.map(getConditionText).join(' AND ') ?? ''}
        onToggle={toggleTradingRule}
        onRemove={removeTradingRule}
        formatTimeAgo={formatTimeAgo}
      />
    </div>
  );
}

function RuleSection({
  title, color, icon, rules, getDescription, onToggle, onRemove, formatTimeAgo,
}: {
  title: string;
  color: string;
  icon: string;
  rules: import('../types').TradingRule[];
  getDescription: (rule: import('../types').TradingRule) => string;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  formatTimeAgo: (d: Date | undefined) => string;
}) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 md:p-6 mb-4">
      <h2 className="text-lg md:text-xl font-semibold mb-4 flex items-center gap-2">
        <span className={color}>{icon}</span> {title}
      </h2>
      {rules.length === 0 ? (
        <p className="text-slate-500 text-sm">No {title.toLowerCase()} configured.</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              rule.enabled ? 'bg-slate-700 border-slate-600' : 'bg-slate-800 border-slate-700 opacity-50'
            }`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{rule.name}</span>
                  {rule.symbol && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-600 text-slate-300">{rule.symbol}</span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    rule.type === 'buy' ? 'bg-emerald-900/60 text-emerald-300' :
                    rule.type === 'sell' ? 'bg-red-900/60 text-red-300' :
                    'bg-purple-900/60 text-purple-300'
                  }`}>
                    {rule.type === 'buy' ? 'BUY' : rule.type === 'sell' ? 'SELL' : 'SHORT'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{getDescription(rule)}</p>
                <p className="text-xs text-slate-600 mt-0.5">Last triggered: {formatTimeAgo(rule.lastTriggered)}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => onToggle(rule.id)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    rule.enabled ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-slate-600 hover:bg-slate-500'
                  }`}>
                  {rule.enabled ? 'On' : 'Off'}
                </button>
                <button onClick={() => onRemove(rule.id)} className="text-slate-500 hover:text-red-400 px-1.5 py-1 text-sm">
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
