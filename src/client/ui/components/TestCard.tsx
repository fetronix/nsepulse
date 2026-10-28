/**
 * One provider self-test result.
 *
 * The card shows whether an outbound call was actually made, because "no network request"
 * and "the request failed" are different facts and are easy to conflate in a status badge.
 */
import type { ProviderTestResult } from '../../../shared/domain.js';
import { Pill } from './Pill.js';
import { formatSetupTime } from './status.js';

export function TestCard({ result }: { result: ProviderTestResult }) {
  return (
    <article className="test-card">
      <div className="test-card-top">
        <div>
          <b>{result.kind === 'CONNECTION' ? 'API connection test' : 'Data-validation test'}</b>
          <small>{result.ranAt ? formatSetupTime(result.ranAt) : 'Not run in this process'}</small>
        </div>
        <Pill value={result.status} />
      </div>
      <p className="test-summary">{result.summary}</p>
      <div className={`network-flag ${result.networkCallMade ? 'network-flag-warn' : ''}`}>
        {result.networkCallMade ? 'Outbound network request made' : 'No outbound network request made'}
      </div>
      {result.checks.length > 0 && (
        <ul className="check-list">
          {result.checks.map((check, index) => (
            <li key={`${check.name}-${index}`}>
              <span
                className={`check-dot ${check.status === 'PASSED' ? 'check-pass' : check.status === 'FAILED' ? 'check-fail' : 'check-blocked'}`}
              />
              <span className="check-body">
                <b>{check.name}</b>
                <small>{check.detail}</small>
              </span>
              <Pill value={check.status} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
