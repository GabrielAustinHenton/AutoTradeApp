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
import { AlertToast } from './components/alerts/AlertToast';
import { usePatternScanner } from './hooks/usePatternScanner';

function AppContent() {
  // Initialize pattern scanner
  usePatternScanner();

  return (
    <>
      <AlertToast />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="portfolio" element={<Portfolio />} />
          <Route path="trade" element={<Trade />} />
          <Route path="history" element={<TradeHistory />} />
          <Route path="charts" element={<Charts />} />
          <Route path="rules" element={<Rules />} />
          <Route path="backtest" element={<Backtest />} />
          <Route path="journal" element={<Journal />} />
          <Route path="settings" element={<Settings />} />
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
