import type { Position, Trade } from '../types';

interface PortfolioExportData {
  positions: Position[];
  trades: Trade[];
  cashBalance: number;
  totalValue: number;
  exportDate: Date;
  portfolioType: 'paper' | 'live';
}

/**
 * Convert positions to CSV format
 */
function positionsToCSV(positions: Position[]): string {
  if (positions.length === 0) {
    return 'No positions';
  }

  const headers = ['Symbol', 'Name', 'Shares', 'Avg Cost', 'Current Price', 'Total Value', 'Gain/Loss', 'Gain/Loss %'];
  const rows = positions.map((p) => [
    p.symbol,
    p.name,
    p.shares.toString(),
    p.avgCost.toFixed(2),
    p.currentPrice.toFixed(2),
    p.totalValue.toFixed(2),
    p.totalGain.toFixed(2),
    p.totalGainPercent.toFixed(2) + '%',
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Convert trades to CSV format
 */
function tradesToCSV(trades: Trade[]): string {
  if (trades.length === 0) {
    return 'No trades';
  }

  const headers = ['Date', 'Symbol', 'Type', 'Shares', 'Price', 'Total', 'Notes'];
  const rows = trades.map((t) => [
    new Date(t.date).toLocaleDateString(),
    t.symbol,
    t.type.toUpperCase(),
    t.shares.toString(),
    t.price.toFixed(2),
    t.total.toFixed(2),
    `"${(t.notes || '').replace(/"/g, '""')}"`, // Escape quotes in notes
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Export portfolio data to CSV file
 */
export function exportToCSV(data: PortfolioExportData): void {
  const { positions, trades, cashBalance, totalValue, exportDate, portfolioType } = data;

  const positionsValue = positions.reduce((sum, p) => sum + p.totalValue, 0);
  const totalGain = positions.reduce((sum, p) => sum + p.totalGain, 0);

  const csvContent = `Portfolio Export - ${portfolioType.toUpperCase()} Trading
Export Date: ${exportDate.toLocaleString()}

=== SUMMARY ===
Cash Balance,$${cashBalance.toFixed(2)}
Positions Value,$${positionsValue.toFixed(2)}
Total Portfolio Value,$${totalValue.toFixed(2)}
Total Unrealized Gain/Loss,$${totalGain.toFixed(2)}

=== POSITIONS ===
${positionsToCSV(positions)}

=== TRADE HISTORY ===
${tradesToCSV(trades)}
`;

  downloadFile(csvContent, `portfolio-${portfolioType}-${formatDateForFilename(exportDate)}.csv`, 'text/csv');
}

/**
 * Export portfolio data to JSON file
 */
export function exportToJSON(data: PortfolioExportData): void {
  const jsonContent = JSON.stringify(
    {
      exportDate: data.exportDate.toISOString(),
      portfolioType: data.portfolioType,
      summary: {
        cashBalance: data.cashBalance,
        totalValue: data.totalValue,
        positionsCount: data.positions.length,
        tradesCount: data.trades.length,
      },
      positions: data.positions.map((p) => ({
        symbol: p.symbol,
        name: p.name,
        shares: p.shares,
        avgCost: p.avgCost,
        currentPrice: p.currentPrice,
        totalValue: p.totalValue,
        totalGain: p.totalGain,
        totalGainPercent: p.totalGainPercent,
      })),
      trades: data.trades.map((t) => ({
        date: new Date(t.date).toISOString(),
        symbol: t.symbol,
        type: t.type,
        shares: t.shares,
        price: t.price,
        total: t.total,
        notes: t.notes,
      })),
    },
    null,
    2
  );

  downloadFile(
    jsonContent,
    `portfolio-${data.portfolioType}-${formatDateForFilename(data.exportDate)}.json`,
    'application/json'
  );
}

/**
 * Generate a printable HTML report
 */
export function exportToPrintableHTML(data: PortfolioExportData): void {
  const { positions, trades, cashBalance, totalValue, exportDate, portfolioType } = data;

  const positionsValue = positions.reduce((sum, p) => sum + p.totalValue, 0);
  const totalGain = positions.reduce((sum, p) => sum + p.totalGain, 0);
  const totalGainPercent = positionsValue > 0 ? (totalGain / (positionsValue - totalGain)) * 100 : 0;

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Portfolio Report - ${portfolioType.toUpperCase()}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { color: #1e293b; border-bottom: 2px solid #10b981; padding-bottom: 10px; }
    h2 { color: #334155; margin-top: 30px; }
    .summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin: 20px 0; }
    .summary-item { background: #f1f5f9; padding: 15px; border-radius: 8px; }
    .summary-item label { color: #64748b; font-size: 12px; display: block; }
    .summary-item value { font-size: 24px; font-weight: bold; color: #1e293b; }
    .positive { color: #10b981; }
    .negative { color: #ef4444; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; color: #475569; font-weight: 600; }
    .type-buy { color: #10b981; font-weight: bold; }
    .type-sell { color: #ef4444; font-weight: bold; }
    .footer { margin-top: 40px; color: #94a3b8; font-size: 12px; text-align: center; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>Portfolio Report - ${portfolioType.toUpperCase()} Trading</h1>
  <p style="color: #64748b;">Generated on ${exportDate.toLocaleString()}</p>

  <div class="summary">
    <div class="summary-item">
      <label>Cash Balance</label>
      <value>$${cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</value>
    </div>
    <div class="summary-item">
      <label>Positions Value</label>
      <value>$${positionsValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</value>
    </div>
    <div class="summary-item">
      <label>Total Portfolio Value</label>
      <value>$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</value>
    </div>
    <div class="summary-item">
      <label>Unrealized Gain/Loss</label>
      <value class="${totalGain >= 0 ? 'positive' : 'negative'}">
        ${totalGain >= 0 ? '+' : ''}$${totalGain.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        (${totalGainPercent >= 0 ? '+' : ''}${totalGainPercent.toFixed(2)}%)
      </value>
    </div>
  </div>

  <h2>Positions (${positions.length})</h2>
  ${
    positions.length > 0
      ? `<table>
    <thead>
      <tr>
        <th>Symbol</th>
        <th>Shares</th>
        <th>Avg Cost</th>
        <th>Current</th>
        <th>Value</th>
        <th>Gain/Loss</th>
      </tr>
    </thead>
    <tbody>
      ${positions
        .map(
          (p) => `<tr>
        <td><strong>${p.symbol}</strong><br><small style="color:#64748b">${p.name}</small></td>
        <td>${p.shares}</td>
        <td>$${p.avgCost.toFixed(2)}</td>
        <td>$${p.currentPrice.toFixed(2)}</td>
        <td>$${p.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        <td class="${p.totalGain >= 0 ? 'positive' : 'negative'}">
          ${p.totalGain >= 0 ? '+' : ''}$${p.totalGain.toFixed(2)} (${p.totalGainPercent >= 0 ? '+' : ''}${p.totalGainPercent.toFixed(2)}%)
        </td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>`
      : '<p style="color:#64748b">No positions</p>'
  }

  <h2>Recent Trades (${Math.min(trades.length, 50)} of ${trades.length})</h2>
  ${
    trades.length > 0
      ? `<table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Symbol</th>
        <th>Type</th>
        <th>Shares</th>
        <th>Price</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${trades
        .slice(0, 50)
        .map(
          (t) => `<tr>
        <td>${new Date(t.date).toLocaleDateString()}</td>
        <td><strong>${t.symbol}</strong></td>
        <td class="type-${t.type}">${t.type.toUpperCase()}</td>
        <td>${t.shares}</td>
        <td>$${t.price.toFixed(2)}</td>
        <td>$${t.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      </tr>`
        )
        .join('')}
    </tbody>
  </table>`
      : '<p style="color:#64748b">No trades</p>'
  }

  <div class="footer">
    <p>Generated by TradeApp</p>
  </div>
</body>
</html>`;

  // Open in new window for printing
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    // Auto-trigger print dialog
    setTimeout(() => printWindow.print(), 250);
  }
}

/**
 * Helper to format date for filename
 */
function formatDateForFilename(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Helper to trigger file download
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
