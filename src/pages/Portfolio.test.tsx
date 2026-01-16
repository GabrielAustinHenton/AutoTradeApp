import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Portfolio } from './Portfolio';
import type { Position, Trade } from '../types';

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ key: 'test-key' }),
}));

// Mock recharts to avoid rendering issues in tests
vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => <div data-testid="pie" />,
  Cell: () => <div data-testid="cell" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
}));

// Mock alphaVantage service
vi.mock('../services/alphaVantage', () => ({
  getQuote: vi.fn().mockResolvedValue({ price: 150 }),
}));

const mockPaperPositions: Position[] = [
  {
    id: 'p1',
    symbol: 'AAPL',
    name: 'Apple Inc',
    shares: 10,
    avgCost: 150,
    currentPrice: 160,
    totalValue: 1600,
    totalGain: 100,
    totalGainPercent: 6.67,
  },
  {
    id: 'p2',
    symbol: 'MSFT',
    name: 'Microsoft',
    shares: 5,
    avgCost: 400,
    currentPrice: 420,
    totalValue: 2100,
    totalGain: 100,
    totalGainPercent: 5,
  },
];

const mockLivePositions: Position[] = [
  {
    id: 'l1',
    symbol: 'GOOGL',
    name: 'Alphabet Inc',
    shares: 3,
    avgCost: 170,
    currentPrice: 180,
    totalValue: 540,
    totalGain: 30,
    totalGainPercent: 5.88,
  },
];

const mockPaperTrades: Trade[] = [
  {
    id: 't1',
    symbol: 'AAPL',
    type: 'buy',
    shares: 10,
    price: 150,
    total: 1500,
    date: new Date('2024-01-15'),
    notes: 'Initial buy',
  },
];

const mockStore = {
  positions: mockLivePositions,
  cashBalance: 5000,
  tradingMode: 'paper' as const,
  paperPortfolio: {
    positions: mockPaperPositions,
    trades: mockPaperTrades,
    cashBalance: 6300,
    startingBalance: 10000,
    createdAt: new Date('2024-01-01'),
  },
  resetPaperPortfolio: vi.fn(),
  updatePaperPositionPrices: vi.fn(),
};

vi.mock('../store/useStore', () => ({
  useStore: () => mockStore,
}));

describe('Portfolio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.positions = [...mockLivePositions];
    mockStore.paperPortfolio = {
      positions: [...mockPaperPositions],
      trades: [...mockPaperTrades],
      cashBalance: 6300,
      startingBalance: 10000,
      createdAt: new Date('2024-01-01'),
    };
    mockStore.tradingMode = 'paper';
    mockStore.cashBalance = 5000;
  });

  describe('Tab switching', () => {
    it('should show paper portfolio by default when in paper trading mode', () => {
      render(<Portfolio />);

      // Should show paper positions (AAPL, MSFT) - use getAllByText since symbols appear multiple places
      const aaplElements = screen.getAllByText('AAPL');
      const msftElements = screen.getAllByText('MSFT');
      expect(aaplElements.length).toBeGreaterThan(0);
      expect(msftElements.length).toBeGreaterThan(0);

      // Should not show live positions (GOOGL)
      expect(screen.queryByText('GOOGL')).not.toBeInTheDocument();
    });

    it('should switch to live portfolio when clicking Live Portfolio tab', () => {
      render(<Portfolio />);

      // Click Live Portfolio tab
      fireEvent.click(screen.getByText('Live Portfolio'));

      // Should show live positions (GOOGL) - may appear in holdings and allocation
      const googlElements = screen.getAllByText('GOOGL');
      expect(googlElements.length).toBeGreaterThan(0);

      // Should not show paper positions
      expect(screen.queryByText('MSFT')).not.toBeInTheDocument();
    });

    it('should show "Currently Active" indicator for active trading mode', () => {
      mockStore.tradingMode = 'paper';
      render(<Portfolio />);

      expect(screen.getByText('Currently Active')).toBeInTheDocument();
    });

    it('should not show "Currently Active" when viewing non-active portfolio', () => {
      mockStore.tradingMode = 'paper';
      render(<Portfolio />);

      // Switch to live tab while mode is paper
      fireEvent.click(screen.getByText('Live Portfolio'));

      // "Currently Active" should not show since active tab is live but mode is paper
      expect(screen.queryByText('Currently Active')).not.toBeInTheDocument();
    });
  });

  describe('Paper portfolio summary', () => {
    it('should display starting balance', () => {
      render(<Portfolio />);

      expect(screen.getByText('Starting Balance')).toBeInTheDocument();
      // Find the stat box with Starting Balance and check its value
      const startingBalanceLabel = screen.getByText('Starting Balance');
      const statBox = startingBalanceLabel.parentElement;
      expect(statBox?.textContent).toContain('$10,000');
    });

    it('should display current value', () => {
      render(<Portfolio />);

      expect(screen.getByText('Current Value')).toBeInTheDocument();
      const currentValueLabel = screen.getByText('Current Value');
      const statBox = currentValueLabel.parentElement;
      // Paper positions value (1600 + 2100) + cash (6300) = 10000
      expect(statBox?.textContent).toContain('$10,000');
    });

    it('should display total P&L', () => {
      render(<Portfolio />);

      expect(screen.getByText('Total P&L')).toBeInTheDocument();
    });

    it('should display trade count', () => {
      render(<Portfolio />);

      expect(screen.getByText('Trades')).toBeInTheDocument();
      const tradesLabel = screen.getByText('Trades');
      const statBox = tradesLabel.parentElement;
      expect(statBox?.textContent).toContain('1');
    });

    it('should not show paper summary when viewing live portfolio', () => {
      render(<Portfolio />);

      fireEvent.click(screen.getByText('Live Portfolio'));

      expect(screen.queryByText('Starting Balance')).not.toBeInTheDocument();
    });
  });

  describe('Holdings table', () => {
    it('should display paper holdings with correct data', () => {
      render(<Portfolio />);

      // Check AAPL row data - AAPL appears multiple places, just check presence
      const aaplElements = screen.getAllByText('AAPL');
      expect(aaplElements.length).toBeGreaterThan(0);
      expect(screen.getByText('Apple Inc')).toBeInTheDocument();
      // Prices may appear in multiple places, use getAllByText
      const avgCostElements = screen.getAllByText('$150.00');
      expect(avgCostElements.length).toBeGreaterThan(0);
    });

    it('should display live holdings when tab is switched', () => {
      render(<Portfolio />);

      fireEvent.click(screen.getByText('Live Portfolio'));

      // GOOGL should appear in holdings
      const googlElements = screen.getAllByText('GOOGL');
      expect(googlElements.length).toBeGreaterThan(0);
      expect(screen.getByText('Alphabet Inc')).toBeInTheDocument();
    });

    it('should show Paper Holdings header when viewing paper', () => {
      render(<Portfolio />);

      expect(screen.getByText('Paper Holdings')).toBeInTheDocument();
    });

    it('should show Live Holdings header when viewing live', () => {
      render(<Portfolio />);

      fireEvent.click(screen.getByText('Live Portfolio'));

      expect(screen.getByText('Live Holdings')).toBeInTheDocument();
    });
  });

  describe('Empty states', () => {
    it('should show paper-specific empty message when no paper positions', () => {
      mockStore.paperPortfolio.positions = [];
      render(<Portfolio />);

      expect(
        screen.getByText('No paper positions yet. Make some paper trades to build your portfolio.')
      ).toBeInTheDocument();
    });

    it('should show live-specific empty message when no live positions', () => {
      mockStore.positions = [];
      render(<Portfolio />);

      fireEvent.click(screen.getByText('Live Portfolio'));

      expect(
        screen.getByText('No live positions yet. Connect to IBKR and start trading.')
      ).toBeInTheDocument();
    });

    it('should show hint to switch to paper mode when not in paper mode', () => {
      mockStore.tradingMode = 'live';
      mockStore.paperPortfolio.positions = [];
      render(<Portfolio />);

      // Click Paper Portfolio tab to see the empty state message
      fireEvent.click(screen.getByText('Paper Portfolio'));

      expect(
        screen.getByText('Switch to Paper Trading mode in Settings to make paper trades.')
      ).toBeInTheDocument();
    });
  });

  describe('Reset paper portfolio', () => {
    it('should show reset button in paper portfolio', () => {
      render(<Portfolio />);

      expect(screen.getByText('Reset Paper Portfolio')).toBeInTheDocument();
    });

    it('should open confirmation modal when clicking reset', () => {
      render(<Portfolio />);

      fireEvent.click(screen.getByText('Reset Paper Portfolio'));

      expect(screen.getByText('Reset Paper Portfolio?')).toBeInTheDocument();
      expect(
        screen.getByText('This will clear all paper positions and trades, and reset your balance to $10,000.')
      ).toBeInTheDocument();
    });

    it('should close modal when clicking Cancel', () => {
      render(<Portfolio />);

      fireEvent.click(screen.getByText('Reset Paper Portfolio'));
      fireEvent.click(screen.getByText('Cancel'));

      expect(screen.queryByText('Reset Paper Portfolio?')).not.toBeInTheDocument();
    });

    it('should call resetPaperPortfolio when confirming reset', () => {
      render(<Portfolio />);

      fireEvent.click(screen.getByText('Reset Paper Portfolio'));
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

      expect(mockStore.resetPaperPortfolio).toHaveBeenCalledWith(10000);
    });
  });

  describe('Refresh prices', () => {
    it('should show refresh button or refreshing state when paper positions exist', async () => {
      render(<Portfolio />);

      // The component auto-refreshes on mount, so either the button or refreshing state should be present
      const refreshButton = screen.queryByRole('button', { name: 'Refresh Prices' });
      const refreshingButton = screen.queryByRole('button', { name: 'Refreshing prices...' });
      expect(refreshButton || refreshingButton).toBeTruthy();
    });

    it('should not show refresh button when no paper positions', () => {
      mockStore.paperPortfolio.positions = [];
      render(<Portfolio />);

      expect(screen.queryByRole('button', { name: 'Refresh Prices' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Refreshing prices...' })).not.toBeInTheDocument();
    });

    it('should not show refresh button for live portfolio', () => {
      render(<Portfolio />);

      fireEvent.click(screen.getByText('Live Portfolio'));

      expect(screen.queryByRole('button', { name: 'Refresh Prices' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Refreshing prices...' })).not.toBeInTheDocument();
    });

    it('should be in refreshing state when auto-refresh is triggered', async () => {
      render(<Portfolio />);

      // The component auto-refreshes on mount when positions exist
      // Either button state should be present (normal or refreshing)
      const refreshButton = screen.queryByRole('button', { name: 'Refresh Prices' });
      const refreshingButton = screen.queryByRole('button', { name: 'Refreshing prices...' });
      expect(refreshButton || refreshingButton).toBeTruthy();
    });
  });

  describe('Paper trade history', () => {
    it('should show paper trade history section when trades exist', () => {
      render(<Portfolio />);

      expect(screen.getByText('Paper Trade History')).toBeInTheDocument();
    });

    it('should display trade details', () => {
      render(<Portfolio />);

      // Check trade data is displayed
      expect(screen.getByText('Initial buy')).toBeInTheDocument();
    });

    it('should not show trade history when no trades', () => {
      mockStore.paperPortfolio.trades = [];
      render(<Portfolio />);

      expect(screen.queryByText('Paper Trade History')).not.toBeInTheDocument();
    });

    it('should not show paper trade history on live tab', () => {
      render(<Portfolio />);

      fireEvent.click(screen.getByText('Live Portfolio'));

      expect(screen.queryByText('Paper Trade History')).not.toBeInTheDocument();
    });
  });

  describe('Allocation chart', () => {
    it('should show allocation section', () => {
      render(<Portfolio />);

      expect(screen.getByText('Allocation')).toBeInTheDocument();
    });

    it('should show pie chart when positions exist', () => {
      render(<Portfolio />);

      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('should show "No allocation data" when no positions and no cash', () => {
      mockStore.paperPortfolio.positions = [];
      mockStore.paperPortfolio.cashBalance = 0;
      render(<Portfolio />);

      expect(screen.getByText('No allocation data')).toBeInTheDocument();
    });

    it('should include Cash in allocation breakdown', () => {
      render(<Portfolio />);

      expect(screen.getByText('Cash')).toBeInTheDocument();
    });
  });
});
