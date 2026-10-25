import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProviderSetupPage } from './ProviderSetupPage.js';

type Health = {
  status: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  database: { configured: boolean; reachable: boolean; message: string };
  providers: { provider: string; configured: boolean; state: string; message: string; dataMode: string }[];
};
type Security = {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  instrumentType: string;
  listingStatus: string;
  sector: string | null;
};
type Overview = {
  sessionStatus: string;
  sessionNote: string;
  currency: string;
  timezone: string;
  indices: { code: string; value: number }[];
  dataFreshness: { latestObservationAt: string | null; status: string };
  counts: { securities: number | null; observations: number | null };
  providerStatuses: { provider: string; state: string; message: string }[];
};
const nav = [
  { id: 'overview', label: 'Market overview', icon: '◫' },
  { id: 'securities', label: 'Stocks explorer', icon: '⌕' },
  { id: 'provider', label: 'Provider setup', icon: '⚙' },
  { id: 'sources', label: 'Data sources', icon: '◉' }
];

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<T>;
}
function formatTime(value: string | null | undefined) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(
        date
      ) + ' EAT'
    : 'Not available';
}
function Logo() {
  return (
    <div className="brand-lockup">
      <div className="brand-mark" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div>
        <b>NSE PULSE</b>
        <small>MARKET INTELLIGENCE</small>
      </div>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [securities, setSecurities] = useState<Security[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Security | null>(null);
  const [quote, setQuote] = useState<{ observation: Record<string, unknown> | null; reason: string | null } | null>(
    null
  );
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const [o, h] = await Promise.all([api<Overview>('/market/overview'), api<Health>('/health')]);
      setOverview(o);
      setHealth(h);
    } catch {
      setError('The API could not be reached. Start the application server or check the deployment health endpoint.');
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
          )}
          {page === 'overview' && (
            <>
              <section className="welcome-row">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-dot" /> NAIROBI SECURITIES EXCHANGE
                  </div>
                  <h1>Market overview</h1>
                  <p className="subtitle">
                    A clear view of Kenya’s listed market — sourced, timestamped, and transparent.
                  </p>
                </div>
                <button className="refresh-button" onClick={() => void refresh()}>
                  <span>↻</span> Refresh status
                </button>
              </section>
              <div className={`notice ${demoMode ? 'demo-notice' : ''}`}>
                <span className="notice-symbol">i</span>
                <div>
                  <b>{demoMode ? 'Demo mode active — no market feed connected' : 'Market feed not connected'}</b>
                  <p>
                    {demoMode
                      ? 'Only synthetic development fixtures are available. They are not NSE prices and carry no market timestamp.'
                      : 'NSE prices and indices are intentionally blank until an authorized data provider is configured. No market values are simulated.'}
                  </p>
                </div>
                <button onClick={() => setPage('provider')}>
                  View provider setup <span>→</span>
                </button>
              </div>
              <section className="metric-grid">
                <article className="metric-card">
                  <div className="metric-top">
                    <span>SESSION STATUS</span>
                    <span className="metric-icon">◷</span>
                  </div>
                  <div className="metric-value">{overview?.sessionStatus ?? '—'}</div>
                  <div className="metric-foot">{overview?.sessionNote ?? 'Checking market calendar'}</div>
                </article>
                <article className="metric-card">
                  <div className="metric-top">
                    <span>SUPPORTED INDICES</span>
                    <span className="metric-icon green">↗</span>
                  </div>
                  <div className="metric-value">{overview?.indices.length ?? '—'}</div>
                  <div className="metric-foot">Verified readings only</div>
                </article>
                <article className="metric-card">
                  <div className="metric-top">
                    <span>SECURITY MASTER</span>
                    <span className="metric-icon">▦</span>
                  </div>
                  <div className="metric-value">{overview?.counts.securities ?? '—'}</div>
                  <div className="metric-foot">
                    {overview?.counts.securities == null ? 'Database not configured' : 'Imported, reviewed securities'}
                  </div>
                </article>
                <article className="metric-card">
                  <div className="metric-top">
                    <span>MARKET DATA FRESHNESS</span>
                    <span className="metric-icon amber">◌</span>
                  </div>
                  <div className="metric-value status-value">{overview?.dataFreshness.status ?? 'CHECKING'}</div>
                  <div className="metric-foot">
                    Last observation: {formatTime(overview?.dataFreshness.latestObservationAt)}
                  </div>
                </article>
              </section>
              <section className="overview-grid">
                <article className="panel performance-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Market indices</h2>
                      <p>Latest available NSE index readings</p>
                    </div>
                    <span className="pill muted">{overview?.currency ?? 'KES'}</span>
                  </div>
                  <div className="empty-chart">
                    <div className="empty-chart-icon">⌁</div>
                    <b>No verified index observations</b>
                    <span>Index history will appear after an authorized source is connected.</span>
                    <div className="chart-grid-lines">
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                  <div className="panel-bottom">
                    <span>Source timestamps will be shown here</span>
                    <span className="freshness-dot" /> Awaiting data
                  </div>
                </article>
                <article className="panel session-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Market pulse</h2>
                      <p>Participation and activity</p>
                    </div>
                    <span className="tiny-calendar">▦</span>
                  </div>
                  <div className="pulse-list">
                    <div className="pulse-row">
                      <span>Advancers</span>
                      <strong>—</strong>
                      <i className="pulse-bar green-bar" />
                    </div>
                    <div className="pulse-row">
                      <span>Decliners</span>
                      <strong>—</strong>
                      <i className="pulse-bar red-bar" />
                    </div>
                    <div className="pulse-row">
                      <span>Unchanged</span>
                      <strong>—</strong>
                      <i className="pulse-bar gray-bar" />
                    </div>
                  </div>
                  <div className="pulse-legend">
                    <span>
                      <i className="legend-green" /> Up
                    </span>
                    <span>
                      <i className="legend-red" /> Down
                    </span>
                    <span>
                      <i className="legend-gray" /> Unchanged
                    </span>
                  </div>
                  <div className="data-callout">
                    <span>!</span>
                    <p>Breadth requires a complete, licensed market snapshot.</p>
                  </div>
                </article>
              </section>
              <section className="lower-grid">
                <article className="panel table-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Most active securities</h2>
                      <p>Ranked by actual reported market activity</p>
                    </div>
                    <button className="text-action" onClick={() => setPage('securities')}>
                      Explore securities →
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>SECURITY</th>
                          <th>LAST PRICE</th>
                          <th>CHANGE</th>
                          <th>VOLUME</th>
                          <th>DATA TIME</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td colSpan={5}>
                            <div className="table-empty">
                              <span>◌</span>
                              <b>Activity data unavailable</b>
                              <small>No volume, turnover, or price data has been configured.</small>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </article>
                <article className="panel events-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Upcoming events</h2>
                      <p>Verified corporate actions</p>
                    </div>
                    <span className="calendar-outline">▦</span>
                  </div>
                  <div className="event-empty">
                    <div className="event-icon">◷</div>
                    <b>No verified events yet</b>
                    <span>
                      Dividend and corporate-action dates will be listed when sourced from issuer disclosures.
                    </span>
                  </div>
                  <button className="full-width-action" onClick={() => setPage('sources')}>
                    Learn about our sources <span>→</span>
                  </button>
                </article>
              </section>
              <div className="disclaimer">
                <span>ⓘ</span> NSE Pulse is an educational research tool. Market data may be delayed or unavailable.
                This is not personalized financial advice.
              </div>
            </>
          )}
          {page === 'securities' && (
            <section className="page-section">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-dot" /> LISTED SECURITIES
                  </div>
                  <h1>{selected ? selected.name : 'Stocks explorer'}</h1>
                  <p className="subtitle">
                    {selected
                      ? `${selected.symbol} · ${selected.instrumentType} · ${selected.exchange}`
                      : 'Search the configured, source-verified security master.'}
                  </p>
                </div>
                {selected && (
                  <button
                    className="refresh-button"
                    onClick={() => {
                      setSelected(null);
                      setQuote(null);
                    }}
                  >
                    ← All securities
                  </button>
                )}
              </div>
              {selected ? (
                <div className="detail-grid">
                  <article className="panel quote-panel">
                    <div className="panel-header">
                      <div>
                        <h2>Latest available quote</h2>
                        <p>
                          {selected.symbol} · {selected.name}
                        </p>
                      </div>
                      <span className="pill muted">
                        {quote?.observation ? String(quote.observation.dataMode) : 'NO DATA'}
                      </span>
                    </div>
                    {quote?.observation ? (
                      <>
                        {quote.observation.demo ? (
                          <div className="demo-inline">DEMO FIXTURE — synthetic values, not an NSE quote</div>
                        ) : null}
                        <div className="quote-price">KES {String(quote.observation.price)}</div>
                        <p className="quote-meta">
                          Source: {String(quote.observation.source)} · Event time:{' '}
                          {formatTime(String(quote.observation.marketEventAt ?? ''))} · Mode:{' '}
                          {String(quote.observation.dataMode)}
                        </p>
                      </>
                    ) : (
                      <div className="empty-detail">
                        <b>Quote unavailable</b>
                        <span>{quote?.reason ?? 'Checking for a stored market observation…'}</span>
                        <small>Prices are not estimated or pulled from unverified display pages.</small>
                      </div>
                    )}
                  </article>
                  <article className="panel">
                    <div className="panel-header">
                      <div>
                        <h2>Security profile</h2>
                        <p>Security master record</p>
                      </div>
                    </div>
                    <dl className="profile-list">
                      <div>
                        <dt>Symbol</dt>
                        <dd>{selected.symbol}</dd>
                      </div>
                      <div>
                        <dt>Exchange</dt>
                        <dd>{selected.exchange}</dd>
                      </div>
                      <div>
                        <dt>Listing status</dt>
                        <dd>{selected.listingStatus}</dd>
                      </div>
                      <div>
                        <dt>Instrument</dt>
                        <dd>{selected.instrumentType}</dd>
                      </div>
                      <div>
                        <dt>Sector</dt>
                        <dd>{selected.sector ?? 'Not verified'}</dd>
                      </div>
                    </dl>
                  </article>
                </div>
              ) : (
                <article className="panel explorer-panel">
                  <div className="explorer-toolbar">
                    <div>
                      <h2>Security directory</h2>
                      <p>
                        {demoMode
                          ? 'Demo fixtures only — synthetic records, not a security master.'
                          : 'Only database-imported, reviewed listings appear.'}
                      </p>
                    </div>
                    <label className="search-box">
                      <span>⌕</span>
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search name or symbol"
                        aria-label="Search securities"
                      />
                      <kbd>↵</kbd>
                    </label>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>SYMBOL</th>
                          <th>COMPANY</th>
                          <th>INSTRUMENT</th>
                          <th>SECTOR</th>
                          <th>STATUS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searching ? (
                          <tr>
                            <td colSpan={5} className="center-cell">
                              Searching security master…
                            </td>
                          </tr>
                        ) : securities.length ? (
                          securities.map((item) => (
                            <tr key={item.id} className="click-row" onClick={() => void openSecurity(item)}>
                              <td>
                                <span className="symbol-chip">{item.symbol}</span>
                              </td>
                              <td className="company-cell">{item.name}</td>
                              <td>{item.instrumentType}</td>
                              <td>{item.sector ?? '—'}</td>
                              <td>
                                <span className="status-tag">{item.listingStatus}</span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5}>
                              <div className="table-empty">
                                <span>⌕</span>
                                <b>
                                  {health?.database.configured ? 'No securities found' : 'Security master is empty'}
                                </b>
                                <small>
                                  {health?.database.configured
                                    ? 'Try another search or import a verified NSE universe.'
                                    : 'Configure PostgreSQL and import an authorized securities list to begin.'}
                                </small>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-pagination">
                    <span>
                      {demoMode
                        ? 'Demo results are synthetic fixtures and must not be treated as NSE listings.'
                        : 'Results are drawn only from the configured database.'}
                    </span>
                    <span>Universe: NSE · Instrument filters require verified classifications</span>
                  </div>
                </article>
              )}
            </section>
          )}
          {page === 'provider' && <ProviderSetupPage onOpenSources={() => setPage('sources')} />}
          {page === 'sources' && (
            <section className="page-section">
              <div className="welcome-row">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-dot" /> PROVENANCE & OPERATIONS
                  </div>
                  <h1>Data sources</h1>
                  <p className="subtitle">Provider configuration, freshness and known access requirements.</p>
                </div>
                <button className="refresh-button" onClick={() => void refresh()}>
                  <span>↻</span> Check status
                </button>
              </div>
              <div className={`source-status-banner ${demoMode ? 'demo-source-banner' : ''}`}>
                <span className="source-state-icon">{demoMode ? '◌' : '!'}</span>
                <div>
                  <b>
                    {demoMode
                      ? 'Demo fixture adapter active — no market-data integration configured'
                      : 'Market-data integration is not configured'}
                  </b>
                  <p>
                    {demoMode
                      ? 'Synthetic development fixtures are labelled as such. No authorized provider credentials or data-use agreement were supplied, and no live feed is claimed.'
                      : 'No authorized provider credentials or data-use agreement were supplied. The app will not scrape, guess, or relabel data.'}
                  </p>
                </div>
                <span className={`pill ${demoMode ? 'muted-pill' : 'amber-pill'}`}>
                  {demoMode ? 'DEMO' : 'UNCONFIGURED'}
                </span>
              </div>
              <div className="source-actions">
                <button className="text-action" onClick={() => setPage('provider')}>
                  Open provider configuration →
                </button>
              </div>
              <div className="source-cards">
                <article className="panel source-card">
                  <div className="source-card-top">
                    <div className="source-logo nse-logo">NSE</div>
                    <span className={`pill ${demoMode ? 'muted-pill' : 'amber-pill'}`}>
                      {demoMode ? 'DEMO' : (connectedProvider?.state ?? 'UNCONFIGURED')}
                    </span>
                  </div>
                  <h2>Nairobi Securities Exchange</h2>
                  <p>
                    Official market data products include live, delayed, end-of-day and historical data. Subscription
                    and permitted use must be confirmed for the specific product and distribution model.
                  </p>
                  <div className="source-facts">
                    <div>
                      <span>DELAYED DATA FLOOR</span>
                      <b>At least 15 minutes</b>
                    </div>
                    <div>
                      <span>HISTORICAL DATA</span>
                      <b>By request / subscription</b>
                    </div>
                    <div>
                      <span>APPLICATION REDISTRIBUTION</span>
                      <b>License may be required</b>
                    </div>
                  </div>
                  <a
                    className="source-link"
                    href="https://www.nse.co.ke/dataservices/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    NSE Data Services <span>↗</span>
                  </a>
                </article>
                <article className="panel source-card">
                  <div className="source-card-top">
                    <div className="source-logo vendor-logo">API</div>
                    <span className="pill muted">NOT CONNECTED</span>
                  </div>
                  <h2>Authorized information vendors</h2>
                  <p>
                    NSE publishes licensed vendors. Selecting a vendor does not itself provide credentials, API access,
                    or permission to redistribute data.
                  </p>
                  <div className="vendor-note">
                    <span>✓</span> Provider adapters remain replaceable and require explicit configuration.
                  </div>
                  <a
                    className="source-link"
                    href="https://www.nse.co.ke/dataservices/nse-licensed-information-vendors/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View licensed-vendor directory <span>↗</span>
                  </a>
                </article>
                <article className="panel source-card">
                  <div className="source-card-top">
                    <div className="source-logo db-logo">DB</div>
                    <span className={`pill ${health?.database.reachable ? 'green-pill' : 'amber-pill'}`}>
                      {health?.database.configured
                        ? health.database.reachable
                          ? 'HEALTHY'
                          : 'UNREACHABLE'
                        : 'NOT CONFIGURED'}
                    </span>
                  </div>
                  <h2>PostgreSQL storage</h2>
                  <p>{health?.database.message ?? 'Checking database configuration.'}</p>
                  <div className="source-facts">
                    <div>
                      <span>SECURITIES</span>
                      <b>{overview?.counts.securities ?? '—'}</b>
                    </div>
                    <div>
                      <span>OBSERVATIONS</span>
                      <b>{overview?.counts.observations ?? '—'}</b>
                    </div>
                    <div>
                      <span>APP VERSION</span>
                      <b>{health?.version ?? '—'}</b>
                    </div>
                  </div>
                </article>
                <article className="panel source-card">
                  <div className="source-card-top">
                    <div className="source-logo bot-logo">✈</div>
                    <span className="pill muted">
                      {health?.providers.some((provider) => provider.configured) ? 'CHECK PROVIDERS' : 'DISABLED'}
                    </span>
                  </div>
                  <h2>Telegram</h2>
                  <p>
                    Bot polling starts only when a bot token is provided. Current commands explain unavailable data
                    honestly; private account ownership and watchlist features are not enabled in this build.
                  </p>
                  <div className="vendor-note">
                    <span>i</span> Never paste bot tokens into this interface or public source control.
                  </div>
                </article>
              </div>
              <article className="panel source-footnote">
                <div>
                  <span className="footnote-icon">i</span>
                  <div>
                    <b>What is required before live use?</b>
                    <p>
                      Obtain a suitable NSE/authorized-vendor subscription; confirm market-data licensing,
                      redistribution, attribution and rate-limit terms; configure the endpoint and credentials as
                      server-side environment secrets; then validate feed timestamps and data mode against provider
                      documentation.
                    </p>
                  </div>
                </div>
              </article>
              <div className="disclaimer">
                <span>ⓘ</span> Provider status only reflects configured application credentials. It is not an
                endorsement or statement of a provider's availability.
              </div>
            </section>
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
