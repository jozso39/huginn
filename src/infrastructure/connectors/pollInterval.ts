import { z } from 'zod';

/** How often a polling connection checks its source. Live connections have no such setting. */
export enum PollInterval {
  Minute1 = 'Minute1',
  Minutes2 = 'Minutes2',
  Minutes5 = 'Minutes5',
  Minutes15 = 'Minutes15',
  Minutes30 = 'Minutes30',
  Hour1 = 'Hour1',
}

const MINUTE = 60_000;

const INTERVAL_MS: Record<PollInterval, number> = {
  [PollInterval.Minute1]: MINUTE,
  [PollInterval.Minutes2]: 2 * MINUTE,
  [PollInterval.Minutes5]: 5 * MINUTE,
  [PollInterval.Minutes15]: 15 * MINUTE,
  [PollInterval.Minutes30]: 30 * MINUTE,
  [PollInterval.Hour1]: 60 * MINUTE,
};

/**
 * The "Check every" field polling connectors add to their config schema. A minute is
 * well inside every provider's limits (Gmail ~2 of 250 quota units a second, ClickUp a
 * handful of its 100 requests a minute, GitLab undocumented); longer only saves calls.
 */
export const pollIntervalField = z
  .enum(PollInterval)
  .default(PollInterval.Minute1)
  .meta({
    title: 'Check every',
    description: 'How often Huginn asks for new and finished items.',
    optionLabels: {
      [PollInterval.Minute1]: 'minute',
      [PollInterval.Minutes2]: '2 minutes',
      [PollInterval.Minutes5]: '5 minutes',
      [PollInterval.Minutes15]: '15 minutes',
      [PollInterval.Minutes30]: '30 minutes',
      [PollInterval.Hour1]: 'hour',
    },
  });

/** `override` (tests) wins, so a test never waits for, or races, a real interval. */
export const pollMs = (interval: PollInterval, override: number | null): number =>
  override ?? INTERVAL_MS[interval];
