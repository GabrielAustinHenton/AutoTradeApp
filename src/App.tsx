import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Dashboard } from './pages/Dashboard';
import { Portfolio } from './pages/Portfolio';
import { Trade } from './pages/Trade';
import { TradeHistory } from './pages/TradeHistory';
import { Charts } from './pages/Charts';
import { Rules } from './pages/Rules';
import { Backtest } from './pages/Backtest';
import { Journal } from './pages/Journal';
import { Settings } from './pages/Settings';
import { SwingTrader } from './pages/SwingTrader';
import { AlertToast } from './components/alerts/AlertToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { usePatternScanner } from './hooks/usePatternScanner';
import { usePositionMonitor } from './hooks/usePositionMonitor';
import { useStore } from './store/useStore';

function AppContent() {
  const syncRulesWithWatchlist = useStore((state) => state.syncRulesWithWatchlist);
  const ibkrConnected = useStore((state) => state.ibkrConnected);
  const tradingMode = useStore((state) => state.tradingMode);
  const setTradingMode = useStore((state) => state.setTradingMode);

  // Initialize pattern scanner
  usePatternScanner();

  // Initialize position monitor for take-profit/stop-loss
  usePositionMonitor();


  // Sync trading rules with watchlist on startup
  useEffect(() => {
    syncRulesWithWatchlist();
  }, [syncRulesWithWatchlist]);

  return (
    <>
      <AlertToast />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<ErrorBoundary section="Dashboard"><Dashboard /></ErrorBoundary>} />
          <Route path="portfolio" element={<ErrorBoundary section="Portfolio"><Portfolio /></ErrorBoundary>} />
          <Route path="trade" element={<ErrorBoundary section="Trade"><Trade /></ErrorBoundary>} />
          <Route path="history" element={<ErrorBoundary section="Trade History"><TradeHistory /></ErrorBoundary>} />
          <Route path="charts" element={<ErrorBoundary section="Charts"><Charts /></ErrorBoundary>} />
          <Route path="rules" element={<ErrorBoundary section="Rules"><Rules /></ErrorBoundary>} />
          <Route path="swing-trader" element={<ErrorBoundary section="Swing Trader"><SwingTrader /></ErrorBoundary>} />
          <Route path="backtest" element={<ErrorBoundary section="Backtest"><Backtest /></ErrorBoundary>} />
          <Route path="journal" element={<ErrorBoundary section="Journal"><Journal /></ErrorBoundary>} />
          <Route path="settings" element={<ErrorBoundary section="Settings"><Settings /></ErrorBoundary>} />
        </Route>
      </Routes>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
