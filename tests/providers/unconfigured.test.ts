import { describe, expect, it } from 'vitest';
import { ProviderRegistry, UnconfiguredProvider } from '../../src/server/providers/types.js';

describe('market provider contract', () => {
  it('reports access as unconfigured and never fabricates quotes', async () => {
    const provider = new UnconfiguredProvider();
    const status = await provider.status();
    expect(status.state).toBe('UNCONFIGURED');
    expect(status.dataMode).toBe('UNKNOWN');
    expect(await provider.getLatestQuote({ symbol: 'SCOM' })).toBeNull();
    expect(await provider.getHistory({ symbol: 'SCOM', from: new Date(), to: new Date(), interval: '1d' })).toEqual([]);
  });
  it('supports independent provider registry replacement', async () => {
    const registry = new ProviderRegistry([new UnconfiguredProvider()]);
    expect((await registry.statuses()).map(s => s.provider)).toEqual(['nse-authorized-feed']);
  });
});
