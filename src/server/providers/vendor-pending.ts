import type { ProviderStatus, ProviderTestResult } from '../../shared/domain.js';
import type {
  HistoricalRequest,
  MarketDataProvider,
  ProviderCapabilities,
  ProviderSelfTest,
  QuoteRequest
} from './types.js';

export interface VendorCredentialState {
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
}

/**
 * Placeholder for a contracted NSE/vendor adapter.
 *
 * It deliberately contains no endpoint, request code, field mapping or coverage claim.
 * Credential presence is recorded only so the configuration page can report it; it never
 * enables a request, and presence alone never marks the provider READY.
 */
export class VendorPendingProvider implements MarketDataProvider {
  readonly id = 'nse-vendor';
  readonly demo = false;
  constructor(private readonly credentials: VendorCredentialState) {}

  capabilities(): ProviderCapabilities {
    return {
      displayName: 'Contracted NSE/vendor feed (adapter not implemented)',
      adapterVersion: '0.1.0',
      accessLevel: 'UNKNOWN',
      entitlement: 'NONE',
      coverage: {
        state: 'NOT_DECLARED',
        securitiesScope:
          'Coverage is undeclared until the signed contract and API specification list the permitted securities.',
        symbols: null,
        symbolCount: null,
        fields: [],
        intervals: [],
        historyDepth: 'Not declared',
        includesIndices: false,
        notes: [
          'Providing a base URL and key does not supply an API contract, field semantics or redistribution rights.',
          'This adapter makes no outbound request; a real implementation must be written and contract-tested first.'
        ]
      },
      demo: false,
      documentationUrl: 'https://www.nse.co.ke/dataservices/'
    };
  }

  async status(): Promise<ProviderStatus> {
    const missing: string[] = [];
    if (!this.credentials.baseUrlConfigured) missing.push('API base URL');
    if (!this.credentials.apiKeyConfigured) missing.push('API key');
    return {
      provider: this.id,
      configured: false,
      state: 'UNCONFIGURED',
      message: `A contracted adapter has not been implemented. Missing: ${missing.length ? missing.join(', ') : 'API specification, field semantics and licensing approval'}. No outbound request is made.`,
      lastSuccessAt: null,
      dataMode: 'UNKNOWN',
      sourceUrl: 'https://www.nse.co.ke/dataservices/',
      displayName: this.capabilities().displayName,
      demo: false
    };
  }

  async getLatestQuote(_request: QuoteRequest): Promise<null> {
    return null;
  }
  async getHistory(_request: HistoricalRequest): Promise<[]> {
    return [];
  }

  async selfTest(now = new Date()): Promise<ProviderSelfTest> {
    const blocked = (kind: ProviderTestResult['kind'], summary: string): ProviderTestResult => ({
      kind,
      status: 'BLOCKED',
      summary,
      ranAt: now.toISOString(),
      networkCallMade: false,
      checks: [
        {
          name: 'Contracted endpoint',
          status: 'BLOCKED',
          detail: this.credentials.baseUrlConfigured
            ? 'A base URL is configured, but no approved API specification or request implementation exists.'
            : 'No base URL configured and none is invented.'
        },
        {
          name: 'Provider credentials',
          status: 'BLOCKED',
          detail: this.credentials.apiKeyConfigured
            ? 'A key is configured, but credentials alone do not establish an integration.'
            : 'No API key configured.'
        },
        {
          name: 'Licensing approval',
          status: 'BLOCKED',
          detail: 'No written entitlement or redistribution approval is recorded.'
        }
      ]
    });
    return {
      connection: blocked(
        'CONNECTION',
        'Connection test blocked: the vendor adapter is not implemented, so no request is attempted.'
      ),
      dataValidation: blocked('DATA_VALIDATION', 'Data validation blocked: no provider payload exists to validate.')
    };
  }
}
