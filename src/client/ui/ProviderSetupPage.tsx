import { useCallback, useEffect, useState } from 'react';
import type {
  AnnouncementsResponse,
  DataSourcesResponse,
  DataSourceView,
  ProviderConfigurationView,
  ProviderTestResult
} from '../../shared/domain.js';

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

function formatTime(value: string | null | undefined) {
  if (!value) return 'Never recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(date) + ' EAT'
    : 'Invalid timestamp';
}

function statusTone(value: string) {
  if (['READY', 'PASSED', 'AVAILABLE', 'GRANTED', 'SATISFIED', 'CONFIGURED'].includes(value)) return 'green-pill';
  if (['UNCONFIGURED', 'NOT_RUN', 'MISSING', 'NOT_CONFIGURED', 'NOT_REQUESTED', 'OUTSTANDING', 'EMPTY', 'DISABLED'].includes(value)) return 'amber-pill';
  if (['DEMO', 'BLOCKED', 'PERMISSION_BLOCKED', 'STORE_UNAVAILABLE', 'IN_PROGRESS', 'UNCONFIRMED', 'NOT_APPLICABLE'].includes(value)) return 'muted-pill';
  if (['ERROR', 'FAILED'].includes(value)) return 'red-pill';
  return 'muted-pill';
}

function Pill({ value }: { value: string }) {
  return <span className={`pill ${statusTone(value)}`}>{value.replaceAll('_', ' ')}</span>;
}

function TestCard({ result }: { result: ProviderTestResult }) {
  return <article className="test-card">
    <div className="test-card-top">
      <div><b>{result.kind === 'CONNECTION' ? 'API connection test' : 'Data-validation test'}</b><small>{result.ranAt ? formatTime(result.ranAt) : 'Not run in this process'}</small></div>
      <Pill value={result.status} />
    </div>
    <p className="test-summary">{result.summary}</p>
    <div className={`network-flag ${result.networkCallMade ? 'network-flag-warn' : ''}`}>
      {result.networkCallMade ? 'Outbound network request made' : 'No outbound network request made'}
    </div>
    {result.checks.length > 0 && <ul className="check-list">
      {result.checks.map((check, index) => <li key={`${check.name}-${index}`}>
        <span className={`check-dot ${check.status === 'PASSED' ? 'check-pass' : check.status === 'FAILED' ? 'check-fail' : 'check-blocked'}`} />
        <span className="check-body"><b>{check.name}</b><small>{check.detail}</small></span>
        <Pill value={check.status} />
      </li>)}
    </ul>}
  </article>;
}

function SourceCard({ source }: { source: DataSourceView }) {
  return <article className="panel source-card">
    <div className="source-card-top">
      <div className="source-logo provider-source-logo">{source.category.slice(0, 3)}</div>
      <Pill value={source.availability.state} />
    </div>
    <h2>{source.name}</h2>
    <p>{source.availability.message}</p>
    <div className="source-facts">
      <div><span>PERMISSION</span><b>{source.permission.status.replaceAll('_', ' ')}</b></div>
      <div><span>FRESHNESS</span><b>{source.freshness.label.replaceAll('_', ' ')}</b></div>
      <div><span>INDEPENDENT OF QUOTE FEED</span><b>{source.independentOfLiveQuoteAdapter ? 'Yes' : 'No'}</b></div>
      <div><span>LAST RECORD</span><b>{formatTime(source.lastRetrievedAt)}</b></div>
    </div>
    <p className="source-permission-basis">{source.permission.basis}</p>
    <ul className="source-notes">{source.notes.map((note) => <li key={note}>{note}</li>)}</ul>
  </article>;
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
      setConfiguration(config); setSources(sourceList); setAnnouncements(announcementList);
    } catch {
      setError('The provider configuration could not be loaded from the API.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function runTests() {
    setRunning(true); setError('');
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

  const configuredCredentials = configuration?.credentials.filter((credential) => credential.state === 'CONFIGURED').length ?? 0;
  const independentSources = sources?.items.filter((source) => source.independentOfLiveQuoteAdapter) ?? [];

  return <section className="page-section">
    <div className="welcome-row">
      <div>
        <div className="eyebrow"><span className="eyebrow-dot" /> MARKET-DATA INTEGRATION</div>
        <h1>Provider setup</h1>
        <p className="subtitle">Adapter status, credential presence, coverage, access level, tests and licensing obligations.</p>
      </div>
      <div className="welcome-actions">
        <button className="refresh-button" onClick={() => void runTests()} disabled={running}>{running ? 'Running…' : '▶ Run connection & validation tests'}</button>
        <button className="refresh-button" onClick={() => void load()}><span>↻</span> Refresh</button>
      </div>
    </div>

    {error && <div className="error-banner"><span>!</span>{error}</div>}

    {configuration?.provider.demo && <div className="demo-banner">
      <span className="demo-tag">DEMO MODE</span>
      <div><b>Synthetic fixture data is being served</b><p>Fixture values are not NSE market data, carry no market timestamp and are never labelled real-time, delayed or end-of-day. Disable demo mode before any user-facing deployment.</p></div>
    </div>}

    {configuration?.environment.demoBlockedReason && <div className="notice">
      <span className="notice-symbol">!</span>
      <div><b>Demo mode was requested but is not active</b><p>{configuration.environment.demoBlockedReason}</p></div>
    </div>}

    {configuration && !configuration.provider.demo && <div className="source-status-banner">
      <span className="source-state-icon">{configuration.environment.liveQuoteAdapterEnabled ? '✓' : '!'}</span>
      <div><b>{configuration.provider.statusLabel} — {configuration.provider.displayName}</b><p>{configuration.provider.statusMessage}</p></div>
      <Pill value={configuration.environment.liveQuoteAdapterEnabled ? 'READY' : 'DISABLED'} />
    </div>}

    {configuration && <>
      <section className="metric-grid">
        <article className="metric-card"><div className="metric-top"><span>INTEGRATION STATUS</span><span className="metric-icon">◇</span></div><div className="metric-value status-value">{configuration.provider.statusLabel}</div><div className="metric-foot">{configuration.environment.liveQuoteAdapterEnabled ? 'Contracted adapter reports ready' : 'Live quote adapter disabled'}</div></article>
        <article className="metric-card"><div className="metric-top"><span>ACCESS LEVEL</span><span className="metric-icon amber">◌</span></div><div className="metric-value status-value">{configuration.access.level.replaceAll('_', ' ')}</div><div className="metric-foot">{configuration.access.entitlementLabel}</div></article>
        <article className="metric-card"><div className="metric-top"><span>API CREDENTIALS</span><span className="metric-icon">⚿</span></div><div className="metric-value">{configuredCredentials}/{configuration.credentials.length}</div><div className="metric-foot">Configured · values never displayed</div></article>
        <article className="metric-card"><div className="metric-top"><span>LAST SUCCESSFUL RETRIEVAL</span><span className="metric-icon green">↻</span></div><div className="metric-value status-value">{configuration.retrieval.lastSuccessfulRetrievalAt ? formatTime(configuration.retrieval.lastSuccessfulRetrievalAt) : 'Never'}</div><div className="metric-foot">Adapter runtime, this process</div></article>
      </section>

      <div className="config-grid">
        <article className="panel config-panel">
          <div className="panel-header"><div><h2>Provider &amp; integration status</h2><p>Application wiring only — not a statement of entitlement</p></div><Pill value={configuration.provider.integrationStatus} /></div>
          <dl className="kv-list">
            <div><dt>Provider</dt><dd>{configuration.provider.displayName}</dd></div>
            <div><dt>Adapter ID</dt><dd className="mono">{configuration.provider.id}</dd></div>
            <div><dt>Adapter version</dt><dd className="mono">{configuration.provider.adapterVersion}</dd></div>
            <div><dt>Requested provider</dt><dd className="mono">MARKET_DATA_PROVIDER={configuration.environment.requestedProvider}</dd></div>
            <div><dt>Environment</dt><dd>{configuration.environment.nodeEnv}</dd></div>
            <div><dt>Enforced default</dt><dd className="mono">MARKET_DATA_PROVIDER={configuration.environment.enforcedDefaultProvider}</dd></div>
            <div><dt>Demo data allowed</dt><dd>{configuration.environment.demoDataAllowed ? 'Yes (synthetic only)' : 'No'}</dd></div>
            <div><dt>Live quote adapter</dt><dd>{configuration.environment.liveQuoteAdapterEnabled ? 'Enabled' : 'Disabled'}</dd></div>
          </dl>
          {configuration.provider.sourceDocumentationUrl && <a className="source-link" href={configuration.provider.sourceDocumentationUrl} target="_blank" rel="noreferrer">Official NSE data-services information <span>↗</span></a>}
          <p className="panel-footnote">No endpoint, credential or coverage value is inferred. Only a signed provider specification may define them.</p>
        </article>

        <article className="panel config-panel">
          <div className="panel-header"><div><h2>API credentials</h2><p>Presence only — secret values are never returned or rendered</p></div></div>
          <ul className="cred-list">
            {configuration.credentials.map((credential) => <li key={credential.key}>
              <div className="cred-head"><span className="mono cred-key">{credential.key}</span><Pill value={credential.state} /></div>
              <div className="cred-meta">{credential.label} · {credential.required ? 'required for a real adapter' : 'not required'}{credential.secret ? ' · secret' : ''}</div>
              <p>{credential.note}</p>
              {credential.blockingForActiveAdapter && <div className="blocking-flag">Blocks a contracted integration</div>}
            </li>)}
          </ul>
          <p className="panel-footnote">Rotate credentials server-side. Never paste keys into this interface or source control.</p>
        </article>

        <article className="panel config-panel">
          <div className="panel-header"><div><h2>Supported NSE securities &amp; data coverage</h2><p>Declared coverage only</p></div><Pill value={configuration.coverage.state} /></div>
          <p className="coverage-scope">{configuration.coverage.securitiesScope}</p>
          <div className="source-facts">
            <div><span>DECLARED SYMBOLS</span><b>{configuration.coverage.symbolCount ?? 'Not declared'}</b></div>
            <div><span>HISTORY DEPTH</span><b>{configuration.coverage.historyDepth}</b></div>
            <div><span>FIELDS</span><b>{configuration.coverage.fields.length ? configuration.coverage.fields.join(', ') : 'None declared'}</b></div>
            <div><span>INTERVALS</span><b>{configuration.coverage.intervals.length ? configuration.coverage.intervals.join(', ') : 'None declared'}</b></div>
            <div><span>INDICES INCLUDED</span><b>{configuration.coverage.includesIndices ? 'Yes' : 'No'}</b></div>
            <div><span>ACCESS LEVEL</span><b>{configuration.access.level.replaceAll('_', ' ')}</b></div>
          </div>
          {configuration.coverage.symbols?.length ? <div className="chip-list">{configuration.coverage.symbols.map((symbol) => <span key={symbol} className="symbol-chip">{symbol}</span>)}</div> : null}
          <ul className="source-notes">{configuration.coverage.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </article>

        <article className="panel config-panel">
          <div className="panel-header"><div><h2>Access level &amp; entitlement</h2><p>Real-time, delayed or end-of-day</p></div><Pill value={configuration.access.entitlement} /></div>
          <div className="access-level">{configuration.access.levelLabel}</div>
          <p className="coverage-scope">{configuration.access.disclosure}</p>
          <div className="source-facts">
            <div><span>ENTITLEMENT</span><b>{configuration.access.entitlementLabel}</b></div>
            <div><span>DATA MODE</span><b>{configuration.access.level}</b></div>
          </div>
          <p className="panel-footnote">Access level changes only with a signed agreement and a matching adapter implementation — never because a credential exists.</p>
        </article>

        <article className="panel config-panel">
          <div className="panel-header"><div><h2>Last successful data retrieval</h2><p>Adapter attempts and persisted records</p></div></div>
          <dl className="kv-list">
            <div><dt>Adapter last success</dt><dd>{formatTime(configuration.retrieval.lastSuccessfulRetrievalAt)}</dd></div>
            <div><dt>Adapter last attempt</dt><dd>{formatTime(configuration.retrieval.lastAttemptAt)}</dd></div>
            <div><dt>Adapter last failure</dt><dd>{formatTime(configuration.retrieval.lastFailureAt)}</dd></div>
            {configuration.retrieval.failureSummary && <div><dt>Failure summary</dt><dd>{configuration.retrieval.failureSummary}</dd></div>}
            <div><dt>Stored quote event at</dt><dd>{formatTime(configuration.retrieval.persistedLatestObservationAt)}</dd></div>
            <div><dt>Stored quote ingested at</dt><dd>{formatTime(configuration.retrieval.persistedLatestIngestionAt)}</dd></div>
            <div><dt>Stored history through</dt><dd>{formatTime(configuration.retrieval.persistedHistoricalThrough)}</dd></div>
          </dl>
          <p className="panel-footnote">{configuration.retrieval.trackingNote}</p>
        </article>

        <article className="panel config-panel">
          <div className="panel-header"><div><h2>Outstanding licensing &amp; approvals</h2><p>Required before any market data is displayed</p></div></div>
          <ul className="lic-list">
            {configuration.licensing.map((item) => <li key={item.id}>
              <div className="lic-head"><b>{item.requirement}</b><Pill value={item.status} /></div>
              <p>{item.detail}</p>
              {item.blocking && <div className="blocking-flag">Blocks live market data</div>}
            </li>)}
          </ul>
        </article>
      </div>

      <section className="test-section">
        <div className="section-heading"><div><h2>API connection &amp; data-validation results</h2><p>{configuration.tests.runNote}</p></div>{ranTests && <span className="pill muted-pill">Just now</span>}</div>
        <div className="test-grid"><TestCard result={configuration.tests.connection} /><TestCard result={configuration.tests.dataValidation} /></div>
      </section>

      {configuration.warnings.length > 0 && <article className="panel warnings-panel">
        <div className="panel-header"><div><h2>Configuration warnings</h2><p>Read before enabling any provider</p></div></div>
        <ul className="source-notes">{configuration.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </article>}
    </>}

    <section className="independent-section">
      <div className="section-heading">
        <div><h2>Independent data sources</h2><p>Historical records and official announcements do not depend on the live quote adapter. Each carries its own permission and freshness label.</p></div>
        <button className="text-action" onClick={onOpenSources}>Source details →</button>
      </div>
      <div className="source-cards">
        {independentSources.map((source) => <SourceCard key={source.id} source={source} />)}
      </div>
      {sources && <p className="section-note">{sources.notes.join(' ')}</p>}
    </section>

    <article className="panel config-panel announcements-panel">
      <div className="panel-header"><div><h2>Official company announcements</h2><p>Reproduced as published; never scraped</p></div><Pill value={announcements?.state ?? 'STORE_UNAVAILABLE'} /></div>
      {announcements?.reason && <p className="coverage-scope">{announcements.reason}</p>}
      <p className="panel-footnote">Permission: {announcements?.permission.status.replaceAll('_', ' ') ?? 'UNCONFIRMED'} — {announcements?.permission.basis ?? 'Not loaded'} · Freshness: {announcements?.freshness.label ?? 'AS_PUBLISHED'}</p>
      {announcements?.items.length ? <div className="table-wrap"><table><thead><tr><th>ANNOUNCEMENT</th><th>PUBLISHER</th><th>PUBLISHED</th><th>SOURCE</th></tr></thead><tbody>
        {announcements.items.map((item) => <tr key={item.id}><td className="company-cell">{item.title}</td><td>{item.publisher}</td><td>{formatTime(item.publishedAt)}</td><td><a className="source-link inline-link" href={item.sourceUrl} target="_blank" rel="noreferrer">Official document ↗</a></td></tr>)}
      </tbody></table></div> : <div className="table-empty"><span>◌</span><b>No announcements are being served</b><small>An operator must record permission and enable an official source before announcements appear here.</small></div>}
    </article>

    <div className="disclaimer"><span>ⓘ</span> Provider status reflects application configuration only. It is not an endorsement, entitlement or claim that live market data is available.</div>
  </section>;
}
