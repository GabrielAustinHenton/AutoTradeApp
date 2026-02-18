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

      <div className="flex-1 flex flex-col overflow-x-hidden">
        {/* Safe area top padding for iPhone notch */}
        <div className="safe-area-top" />

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
