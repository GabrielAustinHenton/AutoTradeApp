import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';

export function Layout() {
  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Desktop sidebar - hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {/* Main content - responsive padding, bottom spacing for mobile nav */}
      <main className="flex-1 p-4 pb-20 md:p-8 md:pb-8 overflow-x-hidden">
        <Outlet />
      </main>

      {/* Mobile bottom navigation - hidden on desktop */}
      <MobileNav />
    </div>
  );
}
