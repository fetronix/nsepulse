/**
 * The four headline numbers for the provider page.
 *
 * "API credentials" counts presence only — the values are never rendered anywhere.
 */
import type { ProviderConfigurationView } from '../../../shared/domain.js';
import { formatSetupTime } from './status.js';

export function ProviderMetrics({
  configuration,
  configuredCredentials
}: {
  configuration: ProviderConfigurationView;
  configuredCredentials: number;
}) {
  return (
    <section className="metric-grid">
      <article className="metric-card">
        <div className="metric-top">
          <span>INTEGRATION STATUS</span>
          <span className="metric-icon">◇</span>
        </div>
        <div className="metric-value status-value">{configuration.provider.statusLabel}</div>
        <div className="metric-foot">
          {configuration.environment.liveQuoteAdapterEnabled
            ? 'Contracted adapter reports ready'
            : 'Live quote adapter disabled'}
        </div>
      </article>
      <article className="metric-card">
        <div className="metric-top">
          <span>ACCESS LEVEL</span>
          <span className="metric-icon amber">◌</span>
        </div>
        <div className="metric-value status-value">{configuration.access.level.replaceAll('_', ' ')}</div>
        <div className="metric-foot">{configuration.access.entitlementLabel}</div>
      </article>
      <article className="metric-card">
        <div className="metric-top">
          <span>API CREDENTIALS</span>
          <span className="metric-icon">⚿</span>
        </div>
        <div className="metric-value">
          {configuredCredentials}/{configuration.credentials.length}
        </div>
        <div className="metric-foot">Configured · values never displayed</div>
      </article>
      <article className="metric-card">
        <div className="metric-top">
          <span>LAST SUCCESSFUL RETRIEVAL</span>
          <span className="metric-icon green">↻</span>
        </div>
        <div className="metric-value status-value">
          {configuration.retrieval.lastSuccessfulRetrievalAt
            ? formatSetupTime(configuration.retrieval.lastSuccessfulRetrievalAt)
            : 'Never'}
        </div>
        <div className="metric-foot">Adapter runtime, this process</div>
      </article>
    </section>
  );
}
