import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../contexts/AuthContext';

// Primary tabs shown in the bottom bar
const primaryTabs = [
  { path: '/', label: 'Home', icon: '📊' },
  { path: '/portfolio', label: 'Portfolio', icon: '💼' },
  { path: '/trade', label: 'Trade', icon: '💹' },
  { path: '/charts', label: 'Charts', icon: '📈' },
];

// All items shown in the "More" menu
const moreItems = [
  { path: '/history', label: 'Trade History', icon: '📜' },
  { path: '/rules', label: 'Trading Rules', icon: '⚙️' },
  { path: '/swing-trader', label: 'Swing Trader', icon: '🔄' },
  { path: '/backtest', label: 'Backtest', icon: '🔬' },
  { path: '/journal', label: 'Journal', icon: '📓' },
  { path: '/settings', label: 'Settings', icon: '🔧' },
];

export function MobileNav() {
  const [showMore, setShowMore] = useState(false);
  const { ibkrConnected } = useStore();
  const { user, userProfile, logOut, isConfigured } = useAuth();

  return (
    <>
      {/* "More" overlay menu */}
      {showMore && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowMore(false)}
          />
          {/* Menu panel - slides up from bottom */}
          <div className="absolute bottom-16 left-0 right-0 bg-slate-900 rounded-t-2xl p-4 pb-2 z-50">
            <div className="w-10 h-1 bg-slate-600 rounded-full mx-auto mb-4" />
            <div className="grid grid-cols-3 gap-2 mb-4">
              {moreItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setShowMore(false)}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors ${
                      isActive
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-300 active:bg-slate-700'
                    }`
                  }
                >
                  <span className="text-xl">{item.icon}</span>
                  <span className="text-xs">{item.label}</span>
                </NavLink>
              ))}
            </div>

            {/* IBKR Status */}
            <div className="flex items-center justify-between p-3 bg-slate-800 rounded-xl mb-2">
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={`w-2 h-2 rounded-full ${
                    ibkrConnected ? 'bg-emerald-500' : 'bg-slate-500'
                  }`}
                />
                <span className="text-slate-400">
                  {ibkrConnected ? 'IBKR Connected' : 'IBKR Not Connected'}
                </span>
              </div>
            </div>

            {/* User info */}
            {isConfigured && user && (
              <div className="flex items-center justify-between p-3 bg-slate-800 rounded-xl">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-emerald-600 flex items-center justify-center text-xs font-bold">
                    {(userProfile?.displayName || user.email || '?')[0].toUpperCase()}
                  </div>
                  <span className="text-sm text-slate-300 truncate max-w-[200px]">
                    {userProfile?.displayName || user.email}
                  </span>
                </div>
                <button
                  onClick={() => { logOut(); setShowMore(false); }}
                  className="text-xs text-slate-400 hover:text-red-400 px-2 py-1"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-slate-900 border-t border-slate-800 safe-area-bottom">
        <div className="flex items-stretch">
          {primaryTabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={tab.path}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2 pt-2.5 transition-colors ${
                  isActive
                    ? 'text-emerald-400'
                    : 'text-slate-500 active:text-slate-300'
                }`
              }
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span className="text-[10px] mt-1">{tab.label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setShowMore(!showMore)}
            className={`flex-1 flex flex-col items-center justify-center py-2 pt-2.5 transition-colors ${
              showMore ? 'text-emerald-400' : 'text-slate-500 active:text-slate-300'
            }`}
          >
            <span className="text-lg leading-none">{'•••'}</span>
            <span className="text-[10px] mt-1">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
