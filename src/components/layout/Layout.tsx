import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { useStore } from '../../store/useStore';
import { IBKR_CONFIG } from '../../config/ibkr';

function IBKRReconnectBanner() {
  const { ibkrConnected, ibkrAuthenticated, syncFromIBKR } = useStore();

  if (!ibkrConnected || ibkrAuthenticated) return null;

  const handleReconnect = () => {
    // Open the IBKR Gateway login page — user logs in, approves 2FA on their phone
    window.open(IBKR_CONFIG.loginUrl, '_blank');
  };

  const handleSyncAfterLogin = async () => {
    await syncFromIBKR().catch(() => {});
  };

  return (
    <div className="bg-amber-900/80 border-b border-amber-700 px-4 py-2 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 text-amber-200">
        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
        <span>IBKR session expired — re-authentication required</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleReconnect}
          className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium transition-colors"
        >
          Log In
        </button>
        <button
          onClick={handleSyncAfterLogin}
          className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Desktop sidebar - hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col overflow-x-hidden">
        {/* IBKR reconnect banner - shows when session expires */}
        <div className="safe-area-top">
          <IBKRReconnectBanner />
        </div>

        {/* Main content */}
        <main className="flex-1 p-4 pb-20 md:p-8 md:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation - hidden on desktop */}
      <MobileNav />
    </div>
  );
}
