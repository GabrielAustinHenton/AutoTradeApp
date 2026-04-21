import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useAuth } from '../../contexts/AuthContext';

const primaryTabs = [
  { path: '/', label: 'Home', icon: '📊' },
  { path: '/history', label: 'History', icon: '📜' },
  { path: '/settings', label: 'Settings', icon: '🔧' },
];

export function MobileNav() {
  const { alpacaConnected } = useStore();
  const { user, userProfile, logOut, isConfigured } = useAuth();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-slate-900 border-t border-slate-800 safe-area-bottom">
      <div className="flex items-stretch">
        {primaryTabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2.5 pt-3 transition-colors ${
                isActive
                  ? 'text-emerald-400'
                  : 'text-slate-500 active:text-slate-300'
              }`
            }
          >
            <span className="text-xl leading-none">{tab.icon}</span>
            <span className="text-[11px] mt-1">{tab.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
