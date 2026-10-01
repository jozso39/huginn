import { describe, expect, test } from 'bun:test';
import { gmailConfigSchema } from './GmailConnector/GmailConnectorFactory';
import { PollInterval, pollMs } from './pollInterval';

describe('Check every', () => {
  test('connections saved before the setting existed check every minute', () => {
    expect(gmailConfigSchema.parse({ inboxScope: 'AllInbox' }).checkEvery).toBe(
      PollInterval.Minute1
    );
    expect(pollMs(PollInterval.Minute1, null)).toBe(60_000);
    expect(pollMs(PollInterval.Minutes15, null)).toBe(15 * 60_000);
  });

  test('an override (tests) wins over the setting', () => {
    expect(pollMs(PollInterval.Minute1, 5)).toBe(5);
  });
});
