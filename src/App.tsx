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
import { Auth } from './pages/Auth';
import { AlertToast } from './components/alerts/AlertToast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { usePatternScanner } from './hooks/usePatternScanner';
import { usePositionMonitor } from './hooks/usePositionMonitor';
import { useIBKRKeepAlive } from './hooks/useIBKRKeepAlive';
import { useStore } from './store/useStore';
import { useAuth } from './contexts/AuthContext';
import { migrateLocalStorageToUser, loadFromFirestore, scheduleSyncToFirestore } from './services/firestoreSync';

function AppContent() {
  const syncRulesWithWatchlist = useStore((state) => state.syncRulesWithWatchlist);

  // Initialize pattern scanner
  usePatternScanner();

  // Initialize position monitor for take-profit/stop-loss
  usePositionMonitor();

  // Keep IBKR session alive
  useIBKRKeepAlive();

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

function AuthGate() {
  const { user, loading, isConfigured } = useAuth();

  // Handle user data migration and Firestore sync on login
  useEffect(() => {
    if (user && isConfigured) {
      // Migrate any existing non-namespaced localStorage data to this user
      migrateLocalStorageToUser(user.uid);

      // Load from Firestore if localStorage is empty (cross-device login)
      loadFromFirestore(user.uid).then((loaded) => {
        if (loaded) {
          // Reload the page to pick up Firestore data in the stores
          window.location.reload();
        }
      });

      // Set up auto-sync: listen for localStorage changes and sync to Firestore
      const handleStorageChange = () => {
        scheduleSyncToFirestore(user.uid);
      };

      // Listen for store changes via storage event
      window.addEventListener('storage', handleStorageChange);

      // Also sync periodically (every 2 minutes) since storage event
      // doesn't fire for same-tab changes
      const syncInterval = setInterval(() => {
        scheduleSyncToFirestore(user.uid);
      }, 120_000);

      return () => {
        window.removeEventListener('storage', handleStorageChange);
        clearInterval(syncInterval);
      };
    }
  }, [user, isConfigured]);

  // Show loading spinner while checking auth state
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  // If Firebase is not configured, skip auth entirely (dev mode)
  if (!isConfigured) {
    return <AppContent />;
  }

  // If not logged in, show auth page
  if (!user) {
    return <Auth />;
  }

  // Authenticated - show app
  return <AppContent />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthGate />
    </BrowserRouter>
  );
}

export default App;
