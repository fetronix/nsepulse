import { useCallback, useEffect, useState } from 'react';
import type { AnnouncementsResponse, DataSourcesResponse, ProviderConfigurationView } from '../../shared/domain.js';
import { Pill } from './components/Pill.js';
import { formatSetupTime } from './components/status.js';
import { ProviderMetrics } from './components/ProviderMetrics.js';
import { ProviderPanels } from './components/ProviderPanels.js';
import { SourceCard } from './components/SourceCard.js';
import { TestCard } from './components/TestCard.js';

/**
 * Provider setup: adapter status, credentials, coverage, tests and licensing obligations.
 *
 * The page itself only loads and holds state; the presentation lives in `./components` so
 * each card can be read, and tested, on its own. Nothing here renders a credential value.
 */
async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<T>;
}
async function post<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method: 'POST', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`API returned ${response.status}`);
  return response.json() as Promise<T>;
}

export function ProviderSetupPage({ onOpenSources }: { onOpenSources: () => void }) {
  const [configuration, setConfiguration] = useState<ProviderConfigurationView | null>(null);
  const [sources, setSources] = useState<DataSourcesResponse | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementsResponse | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [ranTests, setRanTests] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [config, sourceList, announcementList] = await Promise.all([
        get<ProviderConfigurationView>('/providers/configuration'),
        get<DataSourcesResponse>('/data-sources'),
        get<AnnouncementsResponse>('/announcements')
      ]);
      setConfiguration(config);
      setSources(sourceList);
      setAnnouncements(announcementList);
    } catch {
      setError('The provider configuration could not be loaded from the API.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runTests() {
    setRunning(true);
    setError('');
    try {
      const response = await post<{ configuration: ProviderConfigurationView }>('/providers/test');
      setConfiguration(response.configuration);
      setRanTests(true);
      setAnnouncements(await get<AnnouncementsResponse>('/announcements'));
    } catch {
      setError('The provider tests could not be completed.');
    } finally {
      setRunning(false);
    }
  }

  const configuredCredentials =
    configuration?.credentials.filter((credential) => credential.state === 'CONFIGURED').length ?? 0;
  const independentSources = sources?.items.filter((source) => source.independentOfLiveQuoteAdapter) ?? [];

  return (
    <section className="page-section">
      <div className="welcome-row">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> MARKET-DATA INTEGRATION
          </div>
          <h1>Provider setup</h1>
          <p className="subtitle">
            Adapter status, credential presence, coverage, access level, tests and licensing obligations.
          </p>
        </div>
        <div className="welcome-actions">
          <button className="refresh-button" onClick={() => void runTests()} disabled={running}>
            {running ? 'Running…' : '▶ Run connection & validation tests'}
          </button>
          <button className="refresh-button" onClick={() => void load()}>
            <span>↻</span> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>!</span>
          {error}
        </div>
      )}

      {configuration?.provider.demo && (
        <div className="demo-banner">
          <span className="demo-tag">DEMO MODE</span>
          <div>
            <b>Synthetic fixture data is being served</b>
            <p>
              Fixture values are not NSE market data, carry no market timestamp and are never labelled real-time,
              delayed or end-of-day. Disable demo mode before any user-facing deployment.
            </p>
          </div>
        </div>
      )}

      {configuration?.environment.demoBlockedReason && (
        <div className="notice">
          <span className="notice-symbol">!</span>
          <div>
            <b>Demo mode was requested but is not active</b>
            <p>{configuration.environment.demoBlockedReason}</p>
          </div>
        </div>
      )}

      {configuration && !configuration.provider.demo && (
        <div className="source-status-banner">
          <span className="source-state-icon">{configuration.environment.liveQuoteAdapterEnabled ? '✓' : '!'}</span>
          <div>
            <b>
              {configuration.provider.statusLabel} — {configuration.provider.displayName}
            </b>
            <p>{configuration.provider.statusMessage}</p>
          </div>
          <Pill value={configuration.environment.liveQuoteAdapterEnabled ? 'READY' : 'DISABLED'} />
        </div>
      )}

      {configuration && (
        <>
          <ProviderMetrics configuration={configuration} configuredCredentials={configuredCredentials} />

          <ProviderPanels configuration={configuration} />

          <section className="test-section">
            <div className="section-heading">
              <div>
                <h2>API connection &amp; data-validation results</h2>
                <p>{configuration.tests.runNote}</p>
              </div>
              {ranTests && <span className="pill muted-pill">Just now</span>}
            </div>
            <div className="test-grid">
              <TestCard result={configuration.tests.connection} />
              <TestCard result={configuration.tests.dataValidation} />
            </div>
          </section>

          {configuration.warnings.length > 0 && (
            <article className="panel warnings-panel">
              <div className="panel-header">
                <div>
                  <h2>Configuration warnings</h2>
                  <p>Read before enabling any provider</p>
                </div>
              </div>
              <ul className="source-notes">
                {configuration.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </article>
          )}
        </>
      )}

      <section className="independent-section">
        <div className="section-heading">
          <div>
            <h2>Independent data sources</h2>
            <p>
              Historical records and official announcements do not depend on the live quote adapter. Each carries its
              own permission and freshness label.
            </p>
          </div>
          <button className="text-action" onClick={onOpenSources}>
            Source details →
          </button>
        </div>
        <div className="source-cards">
          {independentSources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </div>
        {sources && <p className="section-note">{sources.notes.join(' ')}</p>}
      </section>

      <article className="panel config-panel announcements-panel">
        <div className="panel-header">
          <div>
            <h2>Official company announcements</h2>
            <p>Reproduced as published; never scraped</p>
          </div>
          <Pill value={announcements?.state ?? 'STORE_UNAVAILABLE'} />
        </div>
        {announcements?.reason && <p className="coverage-scope">{announcements.reason}</p>}
        <p className="panel-footnote">
          Permission: {announcements?.permission.status.replaceAll('_', ' ') ?? 'UNCONFIRMED'} —{' '}
          {announcements?.permission.basis ?? 'Not loaded'} · Freshness:{' '}
          {announcements?.freshness.label ?? 'AS_PUBLISHED'}
        </p>
        {announcements?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ANNOUNCEMENT</th>
                  <th>PUBLISHER</th>
                  <th>PUBLISHED</th>
                  <th>SOURCE</th>
                </tr>
              </thead>
              <tbody>
                {announcements.items.map((item) => (
                  <tr key={item.id}>
                    <td className="company-cell">{item.title}</td>
                    <td>{item.publisher}</td>
                    <td>{formatSetupTime(item.publishedAt)}</td>
                    <td>
                      <a className="source-link inline-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
                        Official document ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-empty">
            <span>◌</span>
            <b>No announcements are being served</b>
            <small>
              An operator must record permission and enable an official source before announcements appear here.
            </small>
          </div>
        )}
      </article>

      <div className="disclaimer">
        <span>ⓘ</span> Provider status reflects application configuration only. It is not an endorsement, entitlement or
        claim that live market data is available.
      </div>
    </section>
  );
}
