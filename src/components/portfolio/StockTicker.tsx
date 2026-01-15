import { useQuote } from '../../hooks/useStockData';

interface StockTickerProps {
  symbol: string;
  showDetails?: boolean;
}

export function StockTicker({ symbol, showDetails = false }: StockTickerProps) {
  const { quote, loading, error } = useQuote(symbol, true);

  if (loading && !quote) {
    return (
      <div className="animate-pulse">
        <div className="h-6 bg-slate-700 rounded w-20"></div>
      </div>
    );
  }

  if (error || !quote) {
    return <span className="text-slate-500">--</span>;
  }

  const isPositive = quote.change >= 0;

  return (
    <div className="flex items-center gap-2">
      <span className="font-semibold">${quote.price.toFixed(2)}</span>
      <span className={isPositive ? 'text-emerald-400' : 'text-red-400'}>
        {isPositive ? '+' : ''}
        {quote.change.toFixed(2)} ({isPositive ? '+' : ''}
        {quote.changePercent.toFixed(2)}%)
      </span>
      {showDetails && (
        <span className="text-slate-400 text-sm">
          Vol: {(quote.volume / 1000000).toFixed(2)}M
        </span>
      )}
    </div>
  );
}
