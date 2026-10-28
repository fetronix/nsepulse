/**
 * The stocks explorer: the search results, and the detail view for the selected security.
 *
 * The quote panel is explicit about what it does not know — a missing value shows the reason,
 * and a demo fixture is marked inline instead of being dressed up as a quote.
 */
import type { Health, Quote, Security } from '../api.js';
import { formatTime } from '../api.js';

export interface SecuritiesPageProps {
  securities: Security[];
  query: string;
  setQuery: (value: string) => void;
  searching: boolean;
  selected: Security | null;
  setSelected: (security: Security | null) => void;
  quote: Quote | null;
  setQuote: (quote: Quote | null) => void;
  openSecurity: (security: Security) => Promise<void>;
  demoMode: boolean;
  health: Health | null;
}

export function SecuritiesPage({
  securities,
  query,
  setQuery,
  searching,
  selected,
  setSelected,
  quote,
  setQuote,
  openSecurity,
  demoMode,
  health
}: SecuritiesPageProps) {
  return (
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
              <span className="pill muted">{quote?.observation ? String(quote.observation.dataMode) : 'NO DATA'}</span>
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
                        <b>{health?.database.configured ? 'No securities found' : 'Security master is empty'}</b>
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
  );
}
