import { describe, expect, it } from 'vitest';
import { createProviderSelection } from '../../src/server/providers/factory.js';
import { DEFAULT_PROVIDER_SETTINGS, type ProviderSettings } from '../../src/server/providers/settings.js';
import { ProviderRuntime } from '../../src/server/providers/runtime.js';
import { DemoFixtureProvider } from '../../src/server/providers/demo.js';
import { VendorPendingProvider } from '../../src/server/providers/vendor-pending.js';
import { ProviderConfigurationService } from '../../src/server/services/provider-config.js';

const demoEnv: ProviderSettings = { ...DEFAULT_PROVIDER_SETTINGS, provider: 'demo', allowDemoData: true, nodeEnv: 'development' };

function serviceFor(settings: ProviderSettings) {
  const selection = createProviderSelection(settings);
  const runtime = new ProviderRuntime();
  return { selection, runtime, service: new ProviderConfigurationService(selection, runtime) };
}

describe('provider selection defaults', () => {
  it('keeps the live quote adapter disabled by default', async () => {
    const { selection } = serviceFor(DEFAULT_PROVIDER_SETTINGS);
    expect(selection.requestedProvider).toBe('none');
    expect(selection.provider.id).toBe('nse-authorized-feed');
    expect(selection.provider.demo).toBe(false);
    expect(selection.demoDataAllowed).toBe(false);
    expect((await selection.provider.status()).state).toBe('UNCONFIGURED');
  });

  it('requires an explicit opt-in for demo fixtures', () => {
    const { selection } = serviceFor({ ...demoEnv, allowDemoData: false });
    expect(selection.provider.demo).toBe(false);
    expect(selection.demoBlockedReason).toContain('ALLOW_DEMO_MARKET_DATA');
  });

  it('never enables demo fixtures in production', () => {
    const { selection } = serviceFor({ ...demoEnv, nodeEnv: 'production' });
    expect(selection.provider.demo).toBe(false);
    expect(selection.demoDataAllowed).toBe(false);
    expect(selection.demoBlockedReason).toContain('production');
  });

  it('falls back to the disabled adapter for an unknown provider name', () => {
    const { selection } = serviceFor({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'some-unvetted-vendor' });
    expect(selection.provider.id).toBe('nse-authorized-feed');
    expect(selection.warnings.join(' ')).toContain('Unknown MARKET_DATA_PROVIDER');
  });

  it('does not enable a vendor adapter from credential presence alone', async () => {
    const { selection } = serviceFor({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'nse-vendor', vendorBaseUrlConfigured: true, vendorApiKeyConfigured: true });
    expect(selection.provider).toBeInstanceOf(VendorPendingProvider);
    expect((await selection.provider.status()).state).toBe('UNCONFIGURED');
    expect(await selection.provider.getLatestQuote({ symbol: 'SCOM' })).toBeNull();
  });
});

describe('provider configuration view', () => {
  it('reports missing credentials, undeclared coverage and no access without secrets', async () => {
    const { service } = serviceFor(DEFAULT_PROVIDER_SETTINGS);
    const view = await service.view();
    expect(view.provider.integrationStatus).toBe('UNCONFIGURED');
    expect(view.provider.demo).toBe(false);
    expect(view.environment.liveQuoteAdapterEnabled).toBe(false);
    expect(view.environment.enforcedDefaultProvider).toBe('none');
    expect(view.credentials.map((credential) => credential.state)).toEqual(['MISSING', 'MISSING']);
    expect(view.credentials.filter((credential) => credential.secret).length).toBe(1);
    expect(view.coverage.state).toBe('NOT_DECLARED');
    expect(view.coverage.symbols).toBeNull();
    expect(view.access.level).toBe('UNKNOWN');
    expect(view.access.entitlement).toBe('NONE');
    expect(view.retrieval.lastSuccessfulRetrievalAt).toBeNull();
    expect(view.tests.connection.status).toBe('NOT_RUN');
    expect(view.tests.dataValidation.status).toBe('NOT_RUN');
    expect(view.licensing.some((item) => item.status === 'OUTSTANDING' && item.blocking)).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/api[_-]?key["']?\s*[:=]\s*["'][^"']+["']/i);
  });

  it('returns BLOCKED local tests and records them in memory without a network call', async () => {
    const { runtime, selection, service } = serviceFor(DEFAULT_PROVIDER_SETTINGS);
    const view = await service.runTests(new Date('2026-10-25T09:00:00.000Z'));
    expect(view.tests.connection.status).toBe('BLOCKED');
    expect(view.tests.dataValidation.status).toBe('BLOCKED');
    expect(view.tests.connection.networkCallMade).toBe(false);
    expect(view.tests.connection.ranAt).toBe('2026-10-25T09:00:00.000Z');
    expect(runtime.snapshot(selection.provider.id).connection.status).toBe('BLOCKED');
  });

  it('describes demo mode as synthetic, unlicensed and non-live', async () => {
    const { selection, service } = serviceFor(demoEnv);
    expect(selection.provider).toBeInstanceOf(DemoFixtureProvider);
    const view = await service.view();
    expect(view.provider.demo).toBe(true);
    expect(view.provider.integrationStatus).toBe('DEMO');
    expect(view.access.entitlement).toBe('DEMO_FIXTURE');
    expect(view.access.level).toBe('UNKNOWN');
    expect(view.access.levelLabel).toContain('No market-data access');
    expect(view.coverage.state).toBe('FIXTURE_ONLY');
    expect(view.environment.liveQuoteAdapterEnabled).toBe(false);
    expect(view.credentials.every((credential) => !credential.blockingForActiveAdapter)).toBe(true);
    expect(view.licensing.find((item) => item.id === 'demo-guard')?.blocking).toBe(true);
    expect(view.warnings.join(' ')).toContain('synthetic');
  });

  it('validates demo fixtures locally but refuses to call it a connection test', async () => {
    const { service } = serviceFor(demoEnv);
    const view = await service.runTests();
    expect(view.tests.connection.status).toBe('NOT_APPLICABLE');
    expect(view.tests.connection.networkCallMade).toBe(false);
    expect(view.tests.dataValidation.status).toBe('PASSED');
    expect(view.tests.dataValidation.summary).toContain('says nothing about a real provider');
  });

  it('never includes credential values, only presence', async () => {
    const { service } = serviceFor({ ...DEFAULT_PROVIDER_SETTINGS, provider: 'nse-vendor', vendorBaseUrlConfigured: true, vendorApiKeyConfigured: true });
    const view = await service.view();
    expect(view.credentials.map((credential) => credential.state)).toEqual(['CONFIGURED', 'CONFIGURED']);
    expect(view.credentials[1]!.note).toContain('never returned');
    expect(JSON.stringify(view.credentials)).not.toContain('http');
    expect(view.credentials.every((credential) => !('value' in credential))).toBe(true);
  });
});
