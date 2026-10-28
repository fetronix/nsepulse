/**
 * The market overview: session state, coverage counts, freshness and the honest empty states.
 *
 * Presentational only — it renders what the shell already fetched, so an unreachable API is
 * reported once, by the shell's error banner, rather than twice.
 */
import type { Overview } from '../api.js';
import { formatTime } from '../api.js';

export interface OverviewPageProps {
  overview: Overview | null;
  demoMode: boolean;
  refresh: () => Promise<void>;
  setPage: (page: string) => void;
}

export function OverviewPage({ overview, demoMode, refresh, setPage }: OverviewPageProps) {
  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-dot" /> NAIROBI SECURITIES EXCHANGE
          </div>
          <h1>Market overview</h1>
          <p className="subtitle">A clear view of Kenya’s listed market — sourced, timestamped, and transparent.</p>
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
          <div className="metric-foot">Last observation: {formatTime(overview?.dataFreshness.latestObservationAt)}</div>
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
            <span>Dividend and corporate-action dates will be listed when sourced from issuer disclosures.</span>
          </div>
          <button className="full-width-action" onClick={() => setPage('sources')}>
            Learn about our sources <span>→</span>
          </button>
        </article>
      </section>
      <div className="disclaimer">
        <span>ⓘ</span> NSE Pulse is an educational research tool. Market data may be delayed or unavailable. This is not
        personalized financial advice.
      </div>
    </>
  );
}
