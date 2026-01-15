import { useStore } from '../../store/useStore';
import { PATTERN_INFO } from '../../services/candlestickPatterns';
import { playSound } from '../../services/sounds';
import { format } from 'date-fns';

export function AlertsPanel() {
  const {
    alerts,
    alertsEnabled,
    soundEnabled,
    markAlertRead,
    dismissAlert,
    clearAllAlerts,
    toggleAlerts,
    toggleSound,
  } = useStore();

  const activeAlerts = alerts.filter((a) => !a.dismissed);
  const unreadCount = activeAlerts.filter((a) => !a.read).length;

  const testSound = (type: 'buy' | 'sell') => {
    playSound(type);
  };

  return (
    <div className="bg-slate-800 rounded-xl p-6">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Alerts</h2>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
              {unreadCount} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSound}
            className={`text-sm px-2 py-1 rounded ${
              soundEnabled
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-slate-600 hover:bg-slate-500'
            }`}
            title={soundEnabled ? 'Sound On' : 'Sound Off'}
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>
          <button
            onClick={toggleAlerts}
            className={`text-sm px-3 py-1 rounded ${
              alertsEnabled
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-slate-600 hover:bg-slate-500'
            }`}
          >
            {alertsEnabled ? 'Scanning On' : 'Scanning Off'}
          </button>
        </div>
      </div>

      {/* Sound test buttons */}
      {soundEnabled && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => testSound('buy')}
            className="flex-1 text-xs py-1.5 bg-emerald-900/50 hover:bg-emerald-900 text-emerald-300 rounded transition-colors"
          >
            Test Buy Sound
          </button>
          <button
            onClick={() => testSound('sell')}
            className="flex-1 text-xs py-1.5 bg-red-900/50 hover:bg-red-900 text-red-300 rounded transition-colors"
          >
            Test Sell Sound
          </button>
        </div>
      )}

      {activeAlerts.length > 0 && (
        <div className="flex justify-end mb-3">
          <button
            onClick={clearAllAlerts}
            className="text-xs text-slate-400 hover:text-slate-300"
          >
            Clear All
          </button>
        </div>
      )}

      {activeAlerts.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">🔔</div>
          <p className="text-slate-400">No alerts yet</p>
          <p className="text-sm text-slate-500 mt-1">
            {alertsEnabled
              ? 'Scanning for candlestick patterns...'
              : 'Enable scanning to receive alerts'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {activeAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                alert.read
                  ? 'bg-slate-700/50 border-slate-600'
                  : 'bg-slate-700 border-slate-500'
              }`}
              onClick={() => !alert.read && markAlertRead(alert.id)}
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-lg ${
                      alert.signal === 'buy' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {alert.signal === 'buy' ? '▲' : '▼'}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{alert.symbol}</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          alert.signal === 'buy'
                            ? 'bg-emerald-900 text-emerald-300'
                            : 'bg-red-900 text-red-300'
                        }`}
                      >
                        {alert.signal.toUpperCase()}
                      </span>
                      {!alert.read && (
                        <span className="w-2 h-2 bg-blue-400 rounded-full" />
                      )}
                    </div>
                    <div className="text-sm text-slate-400">
                      {alert.pattern && PATTERN_INFO[alert.pattern]?.name}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {format(new Date(alert.timestamp), 'HH:mm')}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissAlert(alert.id);
                    }}
                    className="text-slate-500 hover:text-slate-300"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {alert.confidence && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Confidence:</span>
                  <div className="flex-1 h-1 bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        alert.signal === 'buy' ? 'bg-emerald-400' : 'bg-red-400'
                      }`}
                      style={{ width: `${alert.confidence}%` }}
                    />
                  </div>
                  <span className="text-slate-500">{alert.confidence}%</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
