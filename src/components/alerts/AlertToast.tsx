import { useEffect, useState, useRef } from 'react';
import { useStore } from '../../store/useStore';
import type { Alert } from '../../types';

export function AlertToast() {
  const { alerts, markAlertRead, dismissAlert } = useStore();
  const [visibleAlerts, setVisibleAlerts] = useState<Alert[]>([]);
  const processedIdsRef = useRef<Set<string>>(new Set());

  // Show new unread alerts as toasts
  useEffect(() => {
    const newAlerts = alerts.filter(
      (a) => !a.read && !a.dismissed && !processedIdsRef.current.has(a.id)
    );

    if (newAlerts.length > 0) {
      // Mark these as processed to avoid re-processing
      newAlerts.forEach(a => processedIdsRef.current.add(a.id));

      setVisibleAlerts((prev) => [...newAlerts.slice(0, 3), ...prev].slice(0, 5));

      // Auto-dismiss after 10 seconds
      newAlerts.forEach((alert) => {
        setTimeout(() => {
          markAlertRead(alert.id);
          setVisibleAlerts((prev) => prev.filter((a) => a.id !== alert.id));
        }, 10000);
      });
    }
  }, [alerts, markAlertRead]);

  const handleDismiss = (id: string) => {
    dismissAlert(id);
    setVisibleAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {visibleAlerts.map((alert) => (
        <div
          key={alert.id}
          className={`p-4 rounded-lg shadow-lg border-l-4 animate-slide-in ${
            alert.signal === 'buy'
              ? 'bg-emerald-900/90 border-emerald-400'
              : 'bg-red-900/90 border-red-400'
          }`}
        >
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{alert.signal === 'buy' ? '📈' : '📉'}</span>
              <div>
                <div className="font-bold text-white">
                  {alert.signal.toUpperCase()} Signal
                </div>
                <div className="text-sm text-white/80">{alert.symbol}</div>
              </div>
            </div>
            <button
              onClick={() => handleDismiss(alert.id)}
              className="text-white/60 hover:text-white"
            >
              ✕
            </button>
          </div>
          <p className="mt-2 text-sm text-white/90">{alert.message}</p>
          {alert.confidence && (
            <div className="mt-2 flex items-center gap-2">
              <div className="text-xs text-white/60">Confidence:</div>
              <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    alert.signal === 'buy' ? 'bg-emerald-400' : 'bg-red-400'
                  }`}
                  style={{ width: `${alert.confidence}%` }}
                />
              </div>
              <div className="text-xs text-white/60">{alert.confidence}%</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
