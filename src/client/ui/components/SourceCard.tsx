/**
 * One independent data source: availability, permission, freshness and its own notes.
 *
 * These sources do not depend on the live quote adapter, so their labels are shown
 * separately instead of being collapsed into the provider status.
 */
import type { DataSourceView } from '../../../shared/domain.js';
import { Pill } from './Pill.js';
import { formatSetupTime } from './status.js';

export function SourceCard({ source }: { source: DataSourceView }) {
  return (
    <article className="panel source-card">
      <div className="source-card-top">
        <div className="source-logo provider-source-logo">{source.category.slice(0, 3)}</div>
        <Pill value={source.availability.state} />
      </div>
      <h2>{source.name}</h2>
      <p>{source.availability.message}</p>
      <div className="source-facts">
        <div>
          <span>PERMISSION</span>
          <b>{source.permission.status.replaceAll('_', ' ')}</b>
        </div>
        <div>
          <span>FRESHNESS</span>
          <b>{source.freshness.label.replaceAll('_', ' ')}</b>
        </div>
        <div>
          <span>INDEPENDENT OF QUOTE FEED</span>
          <b>{source.independentOfLiveQuoteAdapter ? 'Yes' : 'No'}</b>
        </div>
        <div>
          <span>LAST RECORD</span>
          <b>{formatSetupTime(source.lastRetrievedAt)}</b>
        </div>
      </div>
      <p className="source-permission-basis">{source.permission.basis}</p>
      <ul className="source-notes">
        {source.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </article>
  );
}
