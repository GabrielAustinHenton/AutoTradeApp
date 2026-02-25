// ============================================================================
// GitHub Actions API Service
// ============================================================================
// Used to monitor and control the server-side ORB scanner workflow.
// Requires a GitHub fine-grained PAT with:
//   - Repository: AutoTradeApp
//   - Permissions: Actions (Read and write)
// ============================================================================

const REPO_OWNER   = 'GabrielAustinHenton';
const REPO_NAME    = 'AutoTradeApp';
const WORKFLOW_FILE = 'orb-scanner.yml';
const PAT_KEY      = 'github_pat';
const BASE         = 'https://api.github.com';

export type OrbScannerStatus = {
  state: 'active' | 'disabled';
  running: boolean;
  runId: number | null;
};

class GitHubService {
  private pat: string | null = null;

  constructor() {
    try {
      this.pat = localStorage.getItem(PAT_KEY);
    } catch { /* ignore */ }
  }

  configurePat(token: string): void {
    this.pat = token;
    localStorage.setItem(PAT_KEY, token);
  }

  clearPat(): void {
    this.pat = null;
    localStorage.removeItem(PAT_KEY);
  }

  isConfigured(): boolean {
    return !!this.pat;
  }

  private headers(): Record<string, string> {
    if (!this.pat) throw new Error('GitHub PAT not configured');
    return {
      'Authorization': `Bearer ${this.pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async validatePat(): Promise<void> {
    const res = await fetch(`${BASE}/repos/${REPO_OWNER}/${REPO_NAME}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text}`);
    }
  }

  async getOrbScannerStatus(): Promise<OrbScannerStatus> {
    const [workflowRes, runsRes] = await Promise.all([
      fetch(`${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}`, {
        headers: this.headers(),
      }),
      fetch(`${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/runs?status=in_progress`, {
        headers: this.headers(),
      }),
    ]);

    if (!workflowRes.ok) throw new Error(`Workflow status: ${workflowRes.status}`);
    if (!runsRes.ok) throw new Error(`Workflow runs: ${runsRes.status}`);

    const workflow = await workflowRes.json();
    const runs = await runsRes.json();
    const inProgress: { id: number }[] = runs.workflow_runs ?? [];

    return {
      state: workflow.state === 'active' ? 'active' : 'disabled',
      running: inProgress.length > 0,
      runId: inProgress.length > 0 ? inProgress[0].id : null,
    };
  }

  async enableOrbScanner(): Promise<void> {
    const res = await fetch(
      `${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/enable`,
      { method: 'PUT', headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Enable failed: ${res.status}`);
  }

  async disableOrbScanner(): Promise<void> {
    const res = await fetch(
      `${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/disable`,
      { method: 'PUT', headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Disable failed: ${res.status}`);
  }

  async cancelOrbRun(runId: number): Promise<void> {
    const res = await fetch(
      `${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs/${runId}/cancel`,
      { method: 'POST', headers: this.headers() },
    );
    // 202 = accepted (cancel is async on GitHub's side)
    if (!res.ok && res.status !== 202) throw new Error(`Cancel failed: ${res.status}`);
  }

  // ── Watchlist sync (requires Contents: Read and write on PAT) ───────────────

  async getWatchlist(): Promise<string[]> {
    const res = await fetch(
      `${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/config/orb-watchlist.json`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`Get watchlist: ${res.status}`);
    const data = await res.json();
    return JSON.parse(atob(data.content.replace(/\n/g, '')));
  }

  async updateWatchlist(symbols: string[]): Promise<void> {
    // Get current file SHA (required for updates)
    const getRes = await fetch(
      `${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/config/orb-watchlist.json`,
      { headers: this.headers() },
    );
    if (!getRes.ok) throw new Error(`Get watchlist SHA: ${getRes.status}`);
    const current = await getRes.json();

    const content = btoa(JSON.stringify(symbols) + '\n');
    const putRes = await fetch(
      `${BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/config/orb-watchlist.json`,
      {
        method: 'PUT',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Update ORB watchlist (${symbols.length} symbols)`,
          content,
          sha: current.sha,
        }),
      },
    );
    if (!putRes.ok) {
      const text = await putRes.text();
      throw new Error(`Update watchlist: ${putRes.status} ${text}`);
    }
  }
}

export const github = new GitHubService();
