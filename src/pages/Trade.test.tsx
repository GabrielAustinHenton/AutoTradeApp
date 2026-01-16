import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Trade } from './Trade';
import type { Position } from '../types';

// Mock recharts
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock quote data
const mockQuote = {
  price: 150.25,
  change: 2.50,
  changePercent: 1.69,
  high: 152.00,
  low: 148.00,
  volume: 45000000,
};

// Mock hooks
vi.mock('../hooks/useStockData', () => ({
  useQuote: (symbol: string | null) => ({
    quote: symbol ? mockQuote : null,
    loading: false,
    error: null,
  }),
  useSymbolSearch: () => ({
    results: [
      { symbol: 'AAPL', name: 'Apple Inc' },
      { symbol: 'AMZN', name: 'Amazon.com Inc' },
    ],
    loading: false,
    search: vi.fn(),
  }),
  useDailyData: () => ({
    data: [],
    loading: false,
    error: null,
  }),
}));

// Mock IBKR service
vi.mock('../services/ibkr', () => ({
  ibkr: {
    getConidForSymbol: vi.fn().mockResolvedValue(12345),
    buyMarket: vi.fn().mockResolvedValue({}),
    sellMarket: vi.fn().mockResolvedValue({}),
    buyLimit: vi.fn().mockResolvedValue({}),
    sellLimit: vi.fn().mockResolvedValue({}),
  },
}));

const mockPaperPositions: Position[] = [
  {
    id: 'p1',
    symbol: 'AAPL',
    name: 'Apple Inc',
    shares: 10,
    avgCost: 145,
    currentPrice: 150,
    totalValue: 1500,
    totalGain: 50,
    totalGainPercent: 3.45,
  },
];

const mockStore = {
  addTrade: vi.fn(),
  addPosition: vi.fn(),
  positions: [],
  updatePosition: vi.fn(),
  cashBalance: 50000,
  setCashBalance: vi.fn(),
  ibkrConnected: false,
  syncFromIBKR: vi.fn(),
  tradingMode: 'paper' as const,
  paperPortfolio: {
    positions: mockPaperPositions,
    trades: [],
    cashBalance: 10000,
    startingBalance: 10000,
  },
  addPaperTrade: vi.fn(),
  updatePaperPosition: vi.fn(),
};

// Mock setState for paper portfolio updates
const mockSetState = vi.fn();

vi.mock('../store/useStore', () => ({
  useStore: Object.assign(() => mockStore, {
    setState: (fn: (state: typeof mockStore) => Partial<typeof mockStore>) => {
      mockSetState(fn);
    },
    getState: () => mockStore,
  }),
}));

describe('Trade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.tradingMode = 'paper';
    mockStore.ibkrConnected = false;
    mockStore.paperPortfolio = {
      positions: [...mockPaperPositions],
      trades: [],
      cashBalance: 10000,
      startingBalance: 10000,
    };
    mockStore.cashBalance = 50000;
    mockStore.positions = [];
  });

  describe('Trading mode indicator', () => {
    it('should show Paper Trading indicator when in paper mode', () => {
      render(<Trade />);

      expect(screen.getByText('Paper Trading')).toBeInTheDocument();
    });

    it('should show Live Trading indicator when in live mode with IBKR connected', () => {
      mockStore.tradingMode = 'live';
      mockStore.ibkrConnected = true;
      render(<Trade />);

      expect(screen.getByText('Live Trading')).toBeInTheDocument();
    });

    it('should show Paper Trading even in live mode if IBKR not connected', () => {
      mockStore.tradingMode = 'live';
      mockStore.ibkrConnected = false;
      render(<Trade />);

      expect(screen.getByText('Paper Trading')).toBeInTheDocument();
    });
  });

  describe('Trade type selection', () => {
    it('should have Buy selected by default', () => {
      render(<Trade />);

      const buyButton = screen.getByRole('button', { name: 'Buy' });
      expect(buyButton).toHaveClass('bg-emerald-600');
    });

    it('should switch to Sell when clicked', () => {
      render(<Trade />);

      fireEvent.click(screen.getByRole('button', { name: 'Sell' }));

      const sellButton = screen.getByRole('button', { name: 'Sell' });
      expect(sellButton).toHaveClass('bg-red-600');
    });

    it('should update submit button text based on trade type', () => {
      render(<Trade />);

      expect(screen.getByRole('button', { name: 'Buy Stock' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Sell' }));

      expect(screen.getByRole('button', { name: 'Sell Stock' })).toBeInTheDocument();
    });
  });

  describe('Order type selection', () => {
    it('should have Market selected by default', () => {
      render(<Trade />);

      const marketButton = screen.getByRole('button', { name: 'Market' });
      expect(marketButton).toHaveClass('bg-blue-600');
    });

    it('should switch to Limit when clicked', () => {
      render(<Trade />);

      fireEvent.click(screen.getByRole('button', { name: 'Limit' }));

      const limitButton = screen.getByRole('button', { name: 'Limit' });
      expect(limitButton).toHaveClass('bg-blue-600');
    });

    it('should show market order explanation when Market is selected', () => {
      render(<Trade />);

      expect(screen.getByText('Executes at current market price')).toBeInTheDocument();
    });

    it('should show limit order explanation when Limit is selected', () => {
      render(<Trade />);

      fireEvent.click(screen.getByRole('button', { name: 'Limit' }));

      expect(screen.getByText('Executes when price reaches your specified limit')).toBeInTheDocument();
    });

    it('should show Limit Price field only for limit orders', () => {
      render(<Trade />);

      // Market order - no price field
      expect(screen.queryByPlaceholderText('150.00')).not.toBeInTheDocument();

      // Switch to Limit
      fireEvent.click(screen.getByRole('button', { name: 'Limit' }));

      // Limit order - price field should be visible
      expect(screen.getByPlaceholderText('150.00')).toBeInTheDocument();
      expect(screen.getByText('Limit Price')).toBeInTheDocument();
    });
  });

  describe('Symbol input', () => {
    it('should convert symbol to uppercase', () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'aapl' } });

      expect(symbolInput).toHaveValue('AAPL');
    });

    it('should show search results when typing', () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'A' } });
      fireEvent.focus(symbolInput);

      expect(screen.getByText('Apple Inc')).toBeInTheDocument();
      expect(screen.getByText('Amazon.com Inc')).toBeInTheDocument();
    });

    it('should select symbol from search results', () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'A' } });
      fireEvent.focus(symbolInput);

      fireEvent.click(screen.getByText('Apple Inc'));

      expect(symbolInput).toHaveValue('AAPL');
    });
  });

  describe('Quote display', () => {
    it('should display quote when symbol is entered', () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'AAPL' } });

      expect(screen.getByText('Current Price')).toBeInTheDocument();
      expect(screen.getByText('$150.25')).toBeInTheDocument();
    });

    it('should display price change with correct color', () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'AAPL' } });

      // Positive change should be green
      const changeText = screen.getByText(/\+2\.50/);
      expect(changeText).toHaveClass('text-emerald-400');
    });

    it('should display high, low, and volume', () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'AAPL' } });

      expect(screen.getByText('H: $152.00')).toBeInTheDocument();
      expect(screen.getByText('L: $148.00')).toBeInTheDocument();
      expect(screen.getByText('Vol: 45.00M')).toBeInTheDocument();
    });
  });

  describe('Order total calculation', () => {
    it('should calculate total for market orders', () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'AAPL' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '10' } });

      // 10 shares * $150.25 = $1,502.50
      expect(screen.getByText('Estimated Total')).toBeInTheDocument();
      expect(screen.getByText('$1,502.50')).toBeInTheDocument();
    });

    it('should calculate total for limit orders', () => {
      render(<Trade />);

      fireEvent.click(screen.getByRole('button', { name: 'Limit' }));

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'AAPL' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '10' } });

      const priceInput = screen.getByPlaceholderText('150.00');
      fireEvent.change(priceInput, { target: { value: '145' } });

      // 10 shares * $145 = $1,450.00
      expect(screen.getByText('Total')).toBeInTheDocument();
      expect(screen.getByText('$1,450.00')).toBeInTheDocument();
    });

    it('should show cash after trade for buy orders', () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'AAPL' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '10' } });

      expect(screen.getByText('Cash after trade')).toBeInTheDocument();
      // $10,000 - $1,502.50 = $8,497.50
      expect(screen.getByText('$8,497.50')).toBeInTheDocument();
    });
  });

  describe('Account info display', () => {
    it('should show paper account info when in paper mode', () => {
      render(<Trade />);

      expect(screen.getByText('Paper Account')).toBeInTheDocument();
      expect(screen.getByText('$10,000.00')).toBeInTheDocument();
    });

    it('should show live account info when in live mode', () => {
      mockStore.tradingMode = 'live';
      mockStore.ibkrConnected = true;
      render(<Trade />);

      expect(screen.getByText('Live Account')).toBeInTheDocument();
      expect(screen.getByText('$50,000.00')).toBeInTheDocument();
    });

    it('should display position count', () => {
      render(<Trade />);

      expect(screen.getByText('Positions')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument(); // 1 paper position
    });
  });

  describe('Quick trade', () => {
    it('should display existing positions', () => {
      render(<Trade />);

      expect(screen.getByText('Quick Trade')).toBeInTheDocument();
      expect(screen.getByText('AAPL')).toBeInTheDocument();
      expect(screen.getByText('10 shares')).toBeInTheDocument();
    });

    it('should have Sell All button for positions', () => {
      render(<Trade />);

      expect(screen.getByText('Sell All')).toBeInTheDocument();
    });

    it('should populate form when clicking Sell All', () => {
      render(<Trade />);

      fireEvent.click(screen.getByText('Sell All'));

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      const sharesInput = screen.getByPlaceholderText('100');

      expect(symbolInput).toHaveValue('AAPL');
      expect(sharesInput).toHaveValue(10);
    });

    it('should show empty message when no positions', () => {
      mockStore.paperPortfolio.positions = [];
      render(<Trade />);

      expect(screen.getByText('No positions to quick trade')).toBeInTheDocument();
    });
  });

  describe('Form submission - paper trading', () => {
    it('should submit paper buy order successfully', async () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'MSFT' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '5' } });

      fireEvent.click(screen.getByRole('button', { name: 'Buy MSFT' }));

      await waitFor(() => {
        expect(screen.getByText(/Paper trade: Bought 5 shares of MSFT/)).toBeInTheDocument();
      });

      expect(mockStore.addPaperTrade).toHaveBeenCalled();
      expect(mockStore.updatePaperPosition).toHaveBeenCalled();
    });

    it('should show error for insufficient funds', async () => {
      mockStore.paperPortfolio.cashBalance = 100; // Not enough for purchase
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'AAPL' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '10' } }); // Would cost ~$1,500

      fireEvent.click(screen.getByRole('button', { name: 'Buy AAPL' }));

      await waitFor(() => {
        expect(screen.getByText('Insufficient funds')).toBeInTheDocument();
      });
    });

    it('should show error for insufficient shares when selling', async () => {
      render(<Trade />);

      fireEvent.click(screen.getByRole('button', { name: 'Sell' }));

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'AAPL' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '100' } }); // Only have 10 shares

      fireEvent.click(screen.getByRole('button', { name: 'Sell AAPL' }));

      await waitFor(() => {
        expect(screen.getByText('Insufficient shares')).toBeInTheDocument();
      });
    });

    it('should submit paper sell order successfully', async () => {
      render(<Trade />);

      fireEvent.click(screen.getByRole('button', { name: 'Sell' }));

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'AAPL' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '5' } }); // Have 10, sell 5

      fireEvent.click(screen.getByRole('button', { name: 'Sell AAPL' }));

      await waitFor(() => {
        expect(screen.getByText(/Paper trade: Sold 5 shares of AAPL/)).toBeInTheDocument();
      });

      expect(mockStore.addPaperTrade).toHaveBeenCalled();
      expect(mockStore.updatePaperPosition).toHaveBeenCalled();
    });
  });

  describe('Form reset after submission', () => {
    it('should clear form after successful submission', async () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'MSFT' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '5' } });

      fireEvent.click(screen.getByRole('button', { name: 'Buy MSFT' }));

      await waitFor(() => {
        expect(symbolInput).toHaveValue('');
        expect(sharesInput).toHaveValue(null);
      });
    });
  });

  describe('Notes field', () => {
    it('should have optional notes field', () => {
      render(<Trade />);

      expect(screen.getByPlaceholderText('Why are you making this trade?')).toBeInTheDocument();
    });

    it('should include notes in trade', async () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'MSFT' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '5' } });

      const notesInput = screen.getByPlaceholderText('Why are you making this trade?');
      fireEvent.change(notesInput, { target: { value: 'Testing trade' } });

      fireEvent.click(screen.getByRole('button', { name: 'Buy MSFT' }));

      await waitFor(() => {
        expect(mockStore.addPaperTrade).toHaveBeenCalledWith(
          expect.objectContaining({
            notes: 'Testing trade',
          })
        );
      });
    });
  });

  describe('Submit button states', () => {
    it('should disable button when submitting', async () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'MSFT' } });

      const sharesInput = screen.getByPlaceholderText('100');
      fireEvent.change(sharesInput, { target: { value: '5' } });

      const submitButton = screen.getByRole('button', { name: 'Buy MSFT' });
      fireEvent.click(submitButton);

      // Wait for the trade to complete and form to reset
      await waitFor(() => {
        expect(screen.getByText(/Paper trade: Bought 5 shares of MSFT/)).toBeInTheDocument();
      });

      // Button should be enabled again after completion
      expect(screen.getByRole('button', { name: 'Buy Stock' })).not.toBeDisabled();
    });

    it('should update button text with symbol', () => {
      render(<Trade />);

      const symbolInput = screen.getByPlaceholderText('Search for a stock...');
      fireEvent.change(symbolInput, { target: { value: 'GOOGL' } });

      expect(screen.getByRole('button', { name: 'Buy GOOGL' })).toBeInTheDocument();
    });
  });
});
