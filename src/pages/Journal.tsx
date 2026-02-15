import { useState } from 'react';
import { useStore } from '../store/useStore';
import type { JournalEntry } from '../types';
import { format } from 'date-fns';

export function Journal() {
  const { journalEntries, trades, addJournalEntry, updateJournalEntry } =
    useStore();
  const [showForm, setShowForm] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [emotions, setEmotions] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [outcome, setOutcome] = useState<JournalEntry['outcome']>('open');

  const tradesWithoutEntry = trades.filter(
    (t) => !journalEntries.find((e) => e.tradeId === t.id)
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trade = trades.find((t) => t.id === selectedTradeId);
    if (!trade) return;

    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      tradeId: trade.id,
      date: trade.date,
      symbol: trade.symbol,
      type: trade.type,
      shares: trade.shares,
      price: trade.price,
      reasoning,
      emotions: emotions || undefined,
      lessonsLearned: lessonsLearned || undefined,
      outcome,
    };

    addJournalEntry(entry);
    setShowForm(false);
    resetForm();
  };

  const resetForm = () => {
    setSelectedTradeId('');
    setReasoning('');
    setEmotions('');
    setLessonsLearned('');
    setOutcome('open');
  };

  const getOutcomeColor = (outcome?: JournalEntry['outcome']) => {
    switch (outcome) {
      case 'win':
        return 'text-emerald-400';
      case 'loss':
        return 'text-red-400';
      case 'breakeven':
        return 'text-yellow-400';
      default:
        return 'text-slate-400';
    }
  };

  const stats = {
    total: journalEntries.length,
    wins: journalEntries.filter((e) => e.outcome === 'win').length,
    losses: journalEntries.filter((e) => e.outcome === 'loss').length,
    winRate:
      journalEntries.length > 0
        ? (
            (journalEntries.filter((e) => e.outcome === 'win').length /
              journalEntries.filter((e) => e.outcome !== 'open').length) *
            100
          ).toFixed(1)
        : 0,
  };

  return (
    <div className="text-white">
      <div className="flex justify-between items-center mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold">Trading Journal</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-sm md:text-base font-semibold transition-colors"
        >
          {showForm ? 'Cancel' : '+ New Entry'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
        <div className="bg-slate-800 rounded-xl p-3 md:p-4">
          <div className="text-slate-400 text-xs md:text-sm">Total Entries</div>
          <div className="text-xl md:text-2xl font-bold">{stats.total}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 md:p-4">
          <div className="text-slate-400 text-xs md:text-sm">Wins</div>
          <div className="text-xl md:text-2xl font-bold text-emerald-400">{stats.wins}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 md:p-4">
          <div className="text-slate-400 text-xs md:text-sm">Losses</div>
          <div className="text-xl md:text-2xl font-bold text-red-400">{stats.losses}</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-3 md:p-4">
          <div className="text-slate-400 text-xs md:text-sm">Win Rate</div>
          <div className="text-xl md:text-2xl font-bold">{stats.winRate}%</div>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-slate-900 overflow-y-auto p-4 md:static md:z-auto md:bg-transparent md:overflow-visible md:p-0 md:mb-6">
          <div className="bg-slate-800 rounded-xl p-4 md:p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg md:text-xl font-semibold">New Journal Entry</h2>
              <button
                onClick={() => { setShowForm(false); resetForm(); }}
                className="text-slate-400 hover:text-white md:hidden"
              >
                Close
              </button>
            </div>
            {tradesWithoutEntry.length === 0 ? (
              <p className="text-slate-400 text-sm md:text-base">
                All trades have been journaled. Make a new trade first.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
                <div>
                  <label className="block text-xs md:text-sm text-slate-400 mb-1.5 md:mb-2">
                    Select Trade
                  </label>
                  <select
                    value={selectedTradeId}
                    onChange={(e) => setSelectedTradeId(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 md:px-4 md:py-3 text-sm md:text-base focus:outline-none focus:border-emerald-500"
                    required
                  >
                    <option value="">Select a trade...</option>
                    {tradesWithoutEntry.map((trade) => (
                      <option key={trade.id} value={trade.id}>
                        {trade.type.toUpperCase()} {trade.shares} {trade.symbol} @
                        ${trade.price} -{' '}
                        {format(new Date(trade.date), 'MMM d, yyyy')}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs md:text-sm text-slate-400 mb-1.5 md:mb-2">
                    Why did you make this trade? *
                  </label>
                  <textarea
                    value={reasoning}
                    onChange={(e) => setReasoning(e.target.value)}
                    placeholder="What was your thesis? What signals did you see?"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 md:px-4 md:py-3 text-sm md:text-base focus:outline-none focus:border-emerald-500"
                    rows={3}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs md:text-sm text-slate-400 mb-1.5 md:mb-2">
                    How were you feeling?
                  </label>
                  <textarea
                    value={emotions}
                    onChange={(e) => setEmotions(e.target.value)}
                    placeholder="Confident? Anxious? FOMO?"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 md:px-4 md:py-3 text-sm md:text-base focus:outline-none focus:border-emerald-500"
                    rows={2}
                  />
                </div>

                <div>
                  <label className="block text-xs md:text-sm text-slate-400 mb-1.5 md:mb-2">Outcome</label>
                  <div className="flex gap-1.5 md:gap-2">
                    {(['open', 'win', 'loss', 'breakeven'] as const).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => setOutcome(o)}
                        className={`flex-1 py-1.5 md:py-2 rounded-lg capitalize text-sm md:text-base ${
                          outcome === o
                            ? o === 'win'
                              ? 'bg-emerald-600'
                              : o === 'loss'
                              ? 'bg-red-600'
                              : o === 'breakeven'
                              ? 'bg-yellow-600'
                              : 'bg-slate-600'
                            : 'bg-slate-700'
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs md:text-sm text-slate-400 mb-1.5 md:mb-2">
                    Lessons Learned
                  </label>
                  <textarea
                    value={lessonsLearned}
                    onChange={(e) => setLessonsLearned(e.target.value)}
                    placeholder="What would you do differently?"
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 md:px-4 md:py-3 text-sm md:text-base focus:outline-none focus:border-emerald-500"
                    rows={2}
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-700 py-2.5 md:py-3 rounded-lg font-semibold text-sm md:text-base transition-colors"
                >
                  Save Entry
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="bg-slate-800 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">Journal Entries</h2>
        {journalEntries.length === 0 ? (
          <p className="text-slate-400">
            No journal entries yet. Start documenting your trades to improve your
            strategy.
          </p>
        ) : (
          <div className="space-y-4">
            {journalEntries.map((entry) => (
              <div
                key={entry.id}
                className="p-4 bg-slate-700 rounded-lg border border-slate-600"
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-lg">{entry.symbol}</span>
                      <span
                        className={`text-sm px-2 py-0.5 rounded ${
                          entry.type === 'buy'
                            ? 'bg-emerald-900 text-emerald-300'
                            : 'bg-red-900 text-red-300'
                        }`}
                      >
                        {entry.type.toUpperCase()}
                      </span>
                      <span className={`text-sm ${getOutcomeColor(entry.outcome)}`}>
                        {entry.outcome?.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400">
                      {entry.shares} shares @ ${entry.price.toFixed(2)} -{' '}
                      {format(new Date(entry.date), 'MMM d, yyyy')}
                    </div>
                  </div>
                  {entry.outcome === 'open' && (
                    <button
                      onClick={() => {
                        const newOutcome = prompt(
                          'Update outcome (win/loss/breakeven):'
                        ) as JournalEntry['outcome'];
                        if (newOutcome) {
                          updateJournalEntry(entry.id, { outcome: newOutcome });
                        }
                      }}
                      className="text-sm text-emerald-400 hover:text-emerald-300"
                    >
                      Update Outcome
                    </button>
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-slate-400">Reasoning: </span>
                    {entry.reasoning}
                  </div>
                  {entry.emotions && (
                    <div>
                      <span className="text-slate-400">Emotions: </span>
                      {entry.emotions}
                    </div>
                  )}
                  {entry.lessonsLearned && (
                    <div>
                      <span className="text-slate-400">Lessons: </span>
                      {entry.lessonsLearned}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
