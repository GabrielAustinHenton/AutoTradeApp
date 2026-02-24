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
}

export const github = new GitHubService();
