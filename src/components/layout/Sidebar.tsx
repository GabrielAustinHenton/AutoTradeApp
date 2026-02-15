import { NavLink } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../contexts/AuthContext';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/portfolio', label: 'Portfolio', icon: '💼' },
  { path: '/trade', label: 'Trade', icon: '💹' },
  { path: '/history', label: 'Trade History', icon: '📜' },
  { path: '/charts', label: 'Charts', icon: '📈' },
  { path: '/rules', label: 'Trading Rules', icon: '⚙️' },
  { path: '/swing-trader', label: 'Swing Trader', icon: '🔄' },
  { path: '/backtest', label: 'Backtest', icon: '🔬' },
  { path: '/journal', label: 'Journal', icon: '📓' },
  { path: '/settings', label: 'Settings', icon: '🔧' },
];

export function Sidebar() {
  const { ibkrConnected } = useStore();
  const { user, userProfile, logOut, isConfigured } = useAuth();

  const handleSignOut = async () => {
    try {
      await logOut();
    } catch (err) {
      console.error('Failed to sign out:', err);
    }
  };

  return (
    <aside className="w-64 bg-slate-900 text-white min-h-screen p-4 flex flex-col">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-emerald-400">TradeApp</h1>
      </div>
      <nav className="space-y-2 flex-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800'
              }`
            }
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* IBKR Connection Status */}
      <div className="mt-4 p-3 bg-slate-800 rounded-lg">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`w-2 h-2 rounded-full ${
              ibkrConnected ? 'bg-emerald-500' : 'bg-slate-500'
            }`}
          />
          <span className="text-slate-400">
            {ibkrConnected ? 'IBKR Connected' : 'Not Connected'}
          </span>
        </div>
        {!ibkrConnected && (
          <NavLink
            to="/settings"
            className="text-xs text-emerald-400 hover:underline mt-1 block"
          >
            Connect broker
          </NavLink>
        )}
      </div>

      {/* User Account */}
      {isConfigured && user && (
        <div className="mt-3 p-3 bg-slate-800 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-sm font-bold">
              {(userProfile?.displayName || user.email || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {userProfile?.displayName || 'User'}
              </p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full text-xs text-slate-400 hover:text-red-400 py-1 transition-colors"
          >
            Sign Out
          </button>
        </div>
      )}
    </aside>
  );
}
