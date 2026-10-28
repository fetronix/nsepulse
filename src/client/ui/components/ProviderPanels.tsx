/**
 * The provider configuration panels: wiring, access level, coverage, credentials, retrieval
 * and licensing.
 *
 * Each panel is a statement about configuration. None of them asserts that data is flowing.
 */
import type { ProviderConfigurationView } from '../../../shared/domain.js';
import { Pill } from './Pill.js';
import { formatSetupTime } from './status.js';

export function ProviderPanels({ configuration }: { configuration: ProviderConfigurationView }) {
  return (
    <div className="config-grid">
      <article className="panel config-panel">
        <div className="panel-header">
          <div>
            <h2>Provider &amp; integration status</h2>
            <p>Application wiring only — not a statement of entitlement</p>
          </div>
          <Pill value={configuration.provider.integrationStatus} />
        </div>
        <dl className="kv-list">
          <div>
            <dt>Provider</dt>
            <dd>{configuration.provider.displayName}</dd>
          </div>
          <div>
            <dt>Adapter ID</dt>
            <dd className="mono">{configuration.provider.id}</dd>
          </div>
          <div>
            <dt>Adapter version</dt>
            <dd className="mono">{configuration.provider.adapterVersion}</dd>
          </div>
          <div>
            <dt>Requested provider</dt>
            <dd className="mono">MARKET_DATA_PROVIDER={configuration.environment.requestedProvider}</dd>
          </div>
          <div>
            <dt>Environment</dt>
            <dd>{configuration.environment.nodeEnv}</dd>
          </div>
          <div>
            <dt>Enforced default</dt>
            <dd className="mono">MARKET_DATA_PROVIDER={configuration.environment.enforcedDefaultProvider}</dd>
          </div>
          <div>
            <dt>Demo data allowed</dt>
            <dd>{configuration.environment.demoDataAllowed ? 'Yes (synthetic only)' : 'No'}</dd>
          </div>
          <div>
            <dt>Live quote adapter</dt>
            <dd>{configuration.environment.liveQuoteAdapterEnabled ? 'Enabled' : 'Disabled'}</dd>
          </div>
        </dl>
        {configuration.provider.sourceDocumentationUrl && (
          <a
            className="source-link"
            href={configuration.provider.sourceDocumentationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Official NSE data-services information <span>↗</span>
          </a>
        )}
        <p className="panel-footnote">
          No endpoint, credential or coverage value is inferred. Only a signed provider specification may define them.
        </p>
      </article>

      <article className="panel config-panel">
        <div className="panel-header">
          <div>
            <h2>API credentials</h2>
            <p>Presence only — secret values are never returned or rendered</p>
          </div>
        </div>
        <ul className="cred-list">
          {configuration.credentials.map((credential) => (
            <li key={credential.key}>
              <div className="cred-head">
                <span className="mono cred-key">{credential.key}</span>
                <Pill value={credential.state} />
              </div>
              <div className="cred-meta">
                {credential.label} · {credential.required ? 'required for a real adapter' : 'not required'}
                {credential.secret ? ' · secret' : ''}
              </div>
              <p>{credential.note}</p>
              {credential.blockingForActiveAdapter && (
                <div className="blocking-flag">Blocks a contracted integration</div>
              )}
            </li>
          ))}
        </ul>
        <p className="panel-footnote">
          Rotate credentials server-side. Never paste keys into this interface or source control.
        </p>
      </article>

      <article className="panel config-panel">
        <div className="panel-header">
          <div>
            <h2>Supported NSE securities &amp; data coverage</h2>
            <p>Declared coverage only</p>
          </div>
          <Pill value={configuration.coverage.state} />
        </div>
        <p className="coverage-scope">{configuration.coverage.securitiesScope}</p>
        <div className="source-facts">
          <div>
            <span>DECLARED SYMBOLS</span>
            <b>{configuration.coverage.symbolCount ?? 'Not declared'}</b>
          </div>
          <div>
            <span>HISTORY DEPTH</span>
            <b>{configuration.coverage.historyDepth}</b>
          </div>
          <div>
            <span>FIELDS</span>
            <b>{configuration.coverage.fields.length ? configuration.coverage.fields.join(', ') : 'None declared'}</b>
          </div>
          <div>
            <span>INTERVALS</span>
            <b>
              {configuration.coverage.intervals.length ? configuration.coverage.intervals.join(', ') : 'None declared'}
            </b>
          </div>
          <div>
            <span>INDICES INCLUDED</span>
            <b>{configuration.coverage.includesIndices ? 'Yes' : 'No'}</b>
          </div>
          <div>
            <span>ACCESS LEVEL</span>
            <b>{configuration.access.level.replaceAll('_', ' ')}</b>
          </div>
        </div>
        {configuration.coverage.symbols?.length ? (
          <div className="chip-list">
            {configuration.coverage.symbols.map((symbol) => (
              <span key={symbol} className="symbol-chip">
                {symbol}
              </span>
            ))}
          </div>
        ) : null}
        <ul className="source-notes">
          {configuration.coverage.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </article>

      <article className="panel config-panel">
        <div className="panel-header">
          <div>
            <h2>Access level &amp; entitlement</h2>
            <p>Real-time, delayed or end-of-day</p>
          </div>
          <Pill value={configuration.access.entitlement} />
        </div>
        <div className="access-level">{configuration.access.levelLabel}</div>
        <p className="coverage-scope">{configuration.access.disclosure}</p>
        <div className="source-facts">
          <div>
            <span>ENTITLEMENT</span>
            <b>{configuration.access.entitlementLabel}</b>
          </div>
          <div>
            <span>DATA MODE</span>
            <b>{configuration.access.level}</b>
          </div>
        </div>
        <p className="panel-footnote">
          Access level changes only with a signed agreement and a matching adapter implementation — never because a
          credential exists.
        </p>
      </article>

      <article className="panel config-panel">
        <div className="panel-header">
          <div>
            <h2>Last successful data retrieval</h2>
            <p>Adapter attempts and persisted records</p>
          </div>
        </div>
        <dl className="kv-list">
          <div>
            <dt>Adapter last success</dt>
            <dd>{formatSetupTime(configuration.retrieval.lastSuccessfulRetrievalAt)}</dd>
          </div>
          <div>
            <dt>Adapter last attempt</dt>
            <dd>{formatSetupTime(configuration.retrieval.lastAttemptAt)}</dd>
          </div>
          <div>
            <dt>Adapter last failure</dt>
            <dd>{formatSetupTime(configuration.retrieval.lastFailureAt)}</dd>
          </div>
          {configuration.retrieval.failureSummary && (
            <div>
              <dt>Failure summary</dt>
              <dd>{configuration.retrieval.failureSummary}</dd>
            </div>
          )}
          <div>
            <dt>Stored quote event at</dt>
            <dd>{formatSetupTime(configuration.retrieval.persistedLatestObservationAt)}</dd>
          </div>
          <div>
            <dt>Stored quote ingested at</dt>
            <dd>{formatSetupTime(configuration.retrieval.persistedLatestIngestionAt)}</dd>
          </div>
          <div>
            <dt>Stored history through</dt>
            <dd>{formatSetupTime(configuration.retrieval.persistedHistoricalThrough)}</dd>
          </div>
        </dl>
        <p className="panel-footnote">{configuration.retrieval.trackingNote}</p>
      </article>

      <article className="panel config-panel">
        <div className="panel-header">
          <div>
            <h2>Outstanding licensing &amp; approvals</h2>
            <p>Required before any market data is displayed</p>
          </div>
        </div>
        <ul className="lic-list">
          {configuration.licensing.map((item) => (
            <li key={item.id}>
              <div className="lic-head">
                <b>{item.requirement}</b>
                <Pill value={item.status} />
              </div>
              <p>{item.detail}</p>
              {item.blocking && <div className="blocking-flag">Blocks live market data</div>}
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
