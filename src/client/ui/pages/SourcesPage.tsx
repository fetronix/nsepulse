/**
 * Provenance and operations: what each data source is, and what is missing before live use.
 *
 * Every statement here is about configuration state, never about a feed being available.
 */
import type { Health, Overview, ProviderEntry } from '../api.js';

export interface SourcesPageProps {
  health: Health | null;
  overview: Overview | null;
  demoMode: boolean;
  connectedProvider: ProviderEntry | null;
  refresh: () => Promise<void>;
  setPage: (page: string) => void;
}

export function SourcesPage({ health, overview, demoMode, connectedProvider, refresh, setPage }: SourcesPageProps) {
  return (
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
        <span className={`pill ${demoMode ? 'muted-pill' : 'amber-pill'}`}>{demoMode ? 'DEMO' : 'UNCONFIGURED'}</span>
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
            Official market data products include live, delayed, end-of-day and historical data. Subscription and
            permitted use must be confirmed for the specific product and distribution model.
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
          <a className="source-link" href="https://www.nse.co.ke/dataservices/" target="_blank" rel="noreferrer">
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
            NSE publishes licensed vendors. Selecting a vendor does not itself provide credentials, API access, or
            permission to redistribute data.
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
              {health?.database.configured ? (health.database.reachable ? 'HEALTHY' : 'UNREACHABLE') : 'NOT CONFIGURED'}
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
            Bot polling starts only when a bot token is provided. Current commands explain unavailable data honestly;
            private account ownership and watchlist features are not enabled in this build.
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
              Obtain a suitable NSE/authorized-vendor subscription; confirm market-data licensing, redistribution,
              attribution and rate-limit terms; configure the endpoint and credentials as server-side environment
              secrets; then validate feed timestamps and data mode against provider documentation.
            </p>
          </div>
        </div>
      </article>
      <div className="disclaimer">
        <span>ⓘ</span> Provider status only reflects configured application credentials. It is not an endorsement or
        statement of a provider's availability.
      </div>
    </section>
  );
}
