import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProviderSetupPage } from './ProviderSetupPage.js';
import { ApiError, api, type Health, type Overview, type Quote, type Security } from './api.js';
import { Logo } from './components/Logo.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { SecuritiesPage } from './pages/SecuritiesPage.js';
import { SourcesPage } from './pages/SourcesPage.js';

const nav = [
  { id: 'overview', label: 'Market overview', icon: '◫' },
  { id: 'securities', label: 'Stocks explorer', icon: '⌕' },
  { id: 'provider', label: 'Provider setup', icon: '⚙' },
  { id: 'sources', label: 'Data sources', icon: '◉' }
];

export function App() {
  const [page, setPage] = useState('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [securities, setSecurities] = useState<Security[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Security | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [o, h] = await Promise.all([api<Overview>('/market/overview'), api<Health>('/health')]);
      setOverview(o);
      setHealth(h);
    } catch (cause) {
      const explained = cause instanceof ApiError ? cause.serverDetail : null;
      setError(
        explained ??
          'The API could not be reached. Start the application server or check the deployment health endpoint.'
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (page !== 'securities') return;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api<{ items: Security[] }>(`/securities?q=${encodeURIComponent(query)}&limit=50`)
        .then((result) => {
          setSecurities(result.items);
          setSearching(false);
        })
        .catch(() => {
          setSecurities([]);
          setSearching(false);
        });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [page, query]);
  const connectedProvider = useMemo(() => health?.providers.find((item) => item.configured), [health]);
  const demoMode = useMemo(() => Boolean((health as { demoMode?: boolean } | null)?.demoMode), [health]);

  async function openSecurity(security: Security) {
    setSelected(security);
    setQuote(null);
    setPage('securities');
    try {
      setQuote(await api(`/quotes/${encodeURIComponent(security.symbol)}`));
    } catch {
      setQuote({ observation: null, reason: 'Quote API unavailable.' });
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sr-only">NSE Pulse market research dashboard</div>
        <Logo />
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => {
                setPage(item.id);
                if (item.id !== 'securities') {
                  setSelected(null);
                  setQuote(null);
                }
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {page === item.id && <i />}
            </button>
          ))}
        </nav>
        <div className="side-spacer" />
        <div className="sidebar-note">
          <div className="shield-icon">✓</div>
          <b>Evidence first</b>
          <p>Every market observation should carry its source and timestamp.</p>
        </div>
        <div className="side-footer">
          <span className="live-dot" /> Research mode <span className="version">v0.1</span>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="crumb">
            <span>Workspace</span>
            <b>/</b>
            <strong>{nav.find((item) => item.id === page)?.label ?? 'Market overview'}</strong>
          </div>
          <div className="top-actions">
            <div className="timezone">
              <span>◷</span> EAT · Nairobi
            </div>
            <button className="icon-button" aria-label="Refresh data" onClick={() => void refresh()}>
              ↻
            </button>
            <div className="avatar">NP</div>
          </div>
        </header>
        <div className="content">
          {error && (
            <div className="error-banner">
              <span>!</span>
              {error}
            </div>
          )}{' '}
          {page === 'overview' && (
            <OverviewPage overview={overview} demoMode={demoMode} refresh={refresh} setPage={setPage} />
          )}
          {page === 'securities' && (
            <SecuritiesPage
              securities={securities}
              query={query}
              setQuery={setQuery}
              searching={searching}
              selected={selected}
              setSelected={setSelected}
              quote={quote}
              setQuote={setQuote}
              openSecurity={openSecurity}
              demoMode={demoMode}
              health={health}
            />
          )}
          {page === 'provider' && <ProviderSetupPage onOpenSources={() => setPage('sources')} />}
          {page === 'sources' && (
            <SourcesPage
              health={health}
              overview={overview}
              demoMode={demoMode}
              connectedProvider={connectedProvider ?? null}
              refresh={refresh}
              setPage={setPage}
            />
          )}
        </div>
        <footer className="main-footer">
          <span>© 2026 NSE Pulse · Research platform</span>
          <span>All times East Africa Time (UTC+3)</span>
        </footer>
      </main>
    </div>
  );
}
