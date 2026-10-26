import type { ProviderTestResult } from '../../shared/domain.js';
import type { ProviderSelfTest } from './types.js';

export interface ProviderRuntimeSnapshot {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureSummary: string | null;
  connection: ProviderTestResult;
  dataValidation: ProviderTestResult;
}

function emptyTest(kind: ProviderTestResult['kind']): ProviderTestResult {
  return {
    kind,
    status: 'NOT_RUN',
    summary: 'Tests have not been run in this process.',
    ranAt: null,
    networkCallMade: false,
    checks: []
  };
}

const MAX_FAILURE_LENGTH = 240;

/** In-memory runtime facts. Deliberately not persisted; the configuration page says so. */
export class ProviderRuntime {
  private readonly records = new Map<string, ProviderRuntimeSnapshot>();

  private record(providerId: string): ProviderRuntimeSnapshot {
    let existing = this.records.get(providerId);
    if (!existing) {
      existing = {
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        failureSummary: null,
        connection: emptyTest('CONNECTION'),
        dataValidation: emptyTest('DATA_VALIDATION')
      };
      this.records.set(providerId, existing);
    }
    return existing;
  }

  recordRetrievalSuccess(providerId: string, at = new Date()): void {
    const record = this.record(providerId);
    record.lastAttemptAt = at.toISOString();
    record.lastSuccessAt = at.toISOString();
  }

  recordRetrievalFailure(providerId: string, message: string, at = new Date()): void {
    const record = this.record(providerId);
    record.lastAttemptAt = at.toISOString();
    record.lastFailureAt = at.toISOString();
    record.failureSummary = message.slice(0, MAX_FAILURE_LENGTH);
  }

  recordSelfTest(providerId: string, results: ProviderSelfTest): void {
    const record = this.record(providerId);
    record.connection = results.connection;
    record.dataValidation = results.dataValidation;
  }

  snapshot(providerId: string): ProviderRuntimeSnapshot {
    const record = this.record(providerId);
    return { ...record };
  }
}
