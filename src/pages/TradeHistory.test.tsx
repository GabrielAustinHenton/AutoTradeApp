import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TradeHistory } from './TradeHistory';
import type { Trade } from '../types';

// Mock the store
const mockTrades: Trade[] = [
  {
    id: '1',
    symbol: 'AAPL',
    type: 'buy',
    shares: 10,
    price: 150,
    total: 1500,
    date: new Date('2024-01-15'),
    notes: 'Test buy',
  },
  {
    id: '2',
    symbol: 'GOOGL',
    type: 'sell',
    shares: 5,
    price: 140,
    total: 700,
    date: new Date('2024-01-16'),
  },
  {
    id: '3',
    symbol: 'AAPL',
    type: 'sell',
    shares: 5,
    price: 155,
    total: 775,
    date: new Date('2024-01-17'),
  },
];

const mockPaperTrades: Trade[] = [
  {
    id: 'p1',
    symbol: 'TSLA',
    type: 'buy',
    shares: 20,
    price: 200,
    total: 4000,
    date: new Date('2024-01-10'),
  },
  {
    id: 'p2',
    symbol: 'MSFT',
    type: 'buy',
    shares: 15,
    price: 400,
    total: 6000,
    date: new Date('2024-01-12'),
  },
];

const mockStore = {
  trades: mockTrades,
  removeTrade: vi.fn(),
  tradingMode: 'paper' as const,
  paperPortfolio: {
    trades: mockPaperTrades,
    positions: [],
    cashBalance: 10000,
    startingBalance: 10000,
  },
};

vi.mock('../store/useStore', () => ({
  useStore: () => mockStore,
}));

describe('TradeHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.trades = [...mockTrades];
    mockStore.paperPortfolio.trades = [...mockPaperTrades];
    mockStore.tradingMode = 'paper';
  });

  describe('Tab switching', () => {
    it('should show paper trades by default when in paper trading mode', () => {
      render(<TradeHistory />);

      // Should show paper trades (TSLA, MSFT) - use getAllByText since symbols appear in dropdown too
      const tslaElements = screen.getAllByText('TSLA');
      const msftElements = screen.getAllByText('MSFT');
      expect(tslaElements.length).toBeGreaterThan(0);
      expect(msftElements.length).toBeGreaterThan(0);

      // Should not show live trades in table (GOOGL)
      expect(screen.queryByText('GOOGL')).not.toBeInTheDocument();
    });

    it('should switch to live trades when clicking Live Trades tab', () => {
      render(<TradeHistory />);

      // Click Live Trades tab
      fireEvent.click(screen.getByText('Live Trades'));

      // Should show live trades (AAPL, GOOGL)
      const googlElements = screen.getAllByText('GOOGL');
      const aaplElements = screen.getAllByText('AAPL');
      expect(googlElements.length).toBeGreaterThan(0);
      expect(aaplElements.length).toBeGreaterThan(0);

      // Paper-only symbols should not be visible
      expect(screen.queryByText('TSLA')).not.toBeInTheDocument();
      expect(screen.queryByText('MSFT')).not.toBeInTheDocument();
    });

    it('should show "Currently Active" indicator for active trading mode', () => {
      mockStore.tradingMode = 'paper';
      render(<TradeHistory />);

      expect(screen.getByText('Currently Active')).toBeInTheDocument();
    });
  });

  describe('Summary stats', () => {
    it('should calculate correct stats for paper trades', () => {
      render(<TradeHistory />);

      // Paper trades: 2 buys, 0 sells, total buy value = 10000
      // Find Total Trades stat box and check value
      const totalTradesLabel = screen.getByText('Total Trades');
      const totalTradesValue = totalTradesLabel.parentElement?.querySelector('.text-2xl');
      expect(totalTradesValue?.textContent).toBe('2');
    });

    it('should calculate correct stats for live trades', () => {
      render(<TradeHistory />);

      // Switch to live trades
      fireEvent.click(screen.getByText('Live Trades'));

      // Live trades: 1 buy (1500), 2 sells (700 + 775 = 1475)
      const totalTradesLabel = screen.getByText('Total Trades');
      const totalTradesValue = totalTradesLabel.parentElement?.querySelector('.text-2xl');
      expect(totalTradesValue?.textContent).toBe('3');
    });
  });

  describe('Filtering', () => {
    it('should filter trades by type', () => {
      render(<TradeHistory />);

      // Switch to live trades (has both buy and sell)
      fireEvent.click(screen.getByText('Live Trades'));

      // Filter by sell only
      const typeSelect = screen.getByDisplayValue('All Types');
      fireEvent.change(typeSelect, { target: { value: 'sell' } });

      // Should show only sell trades - check the sell count in stats
      const sellOrdersLabel = screen.getByText('Sell Orders');
      const sellOrdersValue = sellOrdersLabel.parentElement?.querySelector('.text-2xl');
      // After filtering by sell, total trades should equal sell count (2)
      const totalTradesLabel = screen.getByText('Total Trades');
      const totalTradesValue = totalTradesLabel.parentElement?.querySelector('.text-2xl');
      expect(totalTradesValue?.textContent).toBe('2');
    });

    it('should show clear filters button when filters are active', () => {
      render(<TradeHistory />);

      // Initially no clear filters button
      expect(screen.queryByText('Clear Filters')).not.toBeInTheDocument();

      // Filter by type
      const typeSelect = screen.getByDisplayValue('All Types');
      fireEvent.change(typeSelect, { target: { value: 'buy' } });

      // Clear filters button should appear
      expect(screen.getByText('Clear Filters')).toBeInTheDocument();
    });

    it('should clear filters when clicking Clear Filters', () => {
      render(<TradeHistory />);

      // Filter by type
      const typeSelect = screen.getByDisplayValue('All Types');
      fireEvent.change(typeSelect, { target: { value: 'buy' } });

      // Click clear filters
      fireEvent.click(screen.getByText('Clear Filters'));

      // Filter should be reset
      expect(screen.getByDisplayValue('All Types')).toBeInTheDocument();
    });
  });

  describe('Empty states', () => {
    it('should show paper-specific empty message when no paper trades', () => {
      mockStore.paperPortfolio.trades = [];
      render(<TradeHistory />);

      expect(
        screen.getByText('No paper trades yet. Switch to paper trading mode and make some trades.')
      ).toBeInTheDocument();
    });

    it('should show live-specific empty message when no live trades', () => {
      mockStore.trades = [];
      render(<TradeHistory />);

      // Switch to live trades
      fireEvent.click(screen.getByText('Live Trades'));

      expect(
        screen.getByText('No live trades yet. Connect to IBKR and start trading.')
      ).toBeInTheDocument();
    });

    it('should show filter empty message when filters exclude all trades', () => {
      render(<TradeHistory />);

      // Paper trades are all buys, filter by sell
      const typeSelect = screen.getByDisplayValue('All Types');
      fireEvent.change(typeSelect, { target: { value: 'sell' } });

      expect(screen.getByText('No trades match the current filters.')).toBeInTheDocument();
    });
  });

  describe('Delete functionality', () => {
    it('should not show delete button for paper trades', () => {
      render(<TradeHistory />);

      // Paper trades tab is active by default
      // Delete buttons should not be visible
      const deleteButtons = screen.queryAllByTitle('Delete trade');
      expect(deleteButtons.length).toBe(0);
    });

    it('should show delete button for live trades', () => {
      render(<TradeHistory />);

      // Switch to live trades
      fireEvent.click(screen.getByText('Live Trades'));

      // Delete buttons should be visible
      const deleteButtons = screen.getAllByTitle('Delete trade');
      expect(deleteButtons.length).toBe(3); // 3 live trades
    });
  });

  describe('Sorting', () => {
    it('should sort by date descending by default', () => {
      render(<TradeHistory />);

      // Switch to live trades (has multiple dates)
      fireEvent.click(screen.getByText('Live Trades'));

      // Check that the date column header shows descending indicator
      expect(screen.getByText('Date ▼')).toBeInTheDocument();
    });

    it('should toggle sort order when clicking same column', () => {
      render(<TradeHistory />);

      // Click date column header
      fireEvent.click(screen.getByText('Date ▼'));

      // Should now show ascending
      expect(screen.getByText('Date ▲')).toBeInTheDocument();
    });

    it('should change sort column when clicking different column', () => {
      render(<TradeHistory />);

      // Click total column header (unique text)
      const totalHeader = screen.getByText('Total');
      fireEvent.click(totalHeader);

      // Should now show total as sorted descending
      expect(screen.getByText('Total ▼')).toBeInTheDocument();
      // Date should no longer show sort indicator
      expect(screen.queryByText('Date ▼')).not.toBeInTheDocument();
      expect(screen.queryByText('Date ▲')).not.toBeInTheDocument();
    });
  });
});
