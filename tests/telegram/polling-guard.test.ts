import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bot } from 'grammy';
import {
  claimPollingSlot,
  isTelegramPollingStarted,
  releasePollingSlot,
  resetTelegramPollingGuardForTests,
  startTelegramBot
} from '../../src/server/telegram/bot.js';

/**
 * The duplicate-reply guard.
 *
 * Two `getUpdates` loops answering the same command is the classic Telegram bot failure: the
 * user gets every reply twice and nothing in the logs looks wrong. These tests pin the
 * in-process half of the protection (the cross-process half is a PostgreSQL advisory lock
 * taken in src/server/index.ts).
 */
afterEach(() => {
  resetTelegramPollingGuardForTests();
  vi.unstubAllGlobals();
});

describe('polling slot', () => {
  it('can be claimed exactly once', () => {
    expect(isTelegramPollingStarted()).toBe(false);
    expect(claimPollingSlot()).toBe(true);
    expect(isTelegramPollingStarted()).toBe(true);
    expect(claimPollingSlot()).toBe(false);
    expect(claimPollingSlot()).toBe(false);
  });

  it('can be released and reclaimed, which is what a clean shutdown allows', () => {
    expect(claimPollingSlot()).toBe(true);
    releasePollingSlot();
    expect(isTelegramPollingStarted()).toBe(false);
    expect(claimPollingSlot()).toBe(true);
  });
});

describe('startTelegramBot', () => {
  it('refuses a second polling loop while one is running', async () => {
    expect(claimPollingSlot()).toBe(true);

    // No network should be attempted at all: the guard is checked before the client is used.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(startTelegramBot('123456:TEST_TOKEN')).rejects.toThrow('refusing to start a second loop');
    expect(fetchSpy).not.toHaveBeenCalled();
    // The failed attempt must not have released the slot it never owned.
    expect(isTelegramPollingStarted()).toBe(true);
  });

  it('releases the slot when startup fails, so a supervisor can retry', async () => {
    // `bot.start()` is the seam: stubbing it keeps this off the network. (grammy retries
    // failed long-polling calls rather than rejecting, so the real call cannot be used here.)
    const start = vi.spyOn(Bot.prototype, 'start').mockRejectedValue(new Error('startup failed'));

    try {
      await expect(startTelegramBot('123456:TEST_TOKEN')).rejects.toThrow('startup failed');
      expect(isTelegramPollingStarted()).toBe(false);

      // A retry is therefore allowed to claim the slot rather than being locked out forever.
      expect(claimPollingSlot()).toBe(true);
    } finally {
      start.mockRestore();
    }
  });
});
