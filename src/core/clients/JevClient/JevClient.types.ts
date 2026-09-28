/**
 * Jev (TypeSafe's System One model): typed questions about a state, calibrated
 * probabilities back. Huginn only asks yes/no ("noul") questions.
 */
export interface IJevClient {
  /**
   * Asks every question about the one state in a single call. Keys are the
   * caller's; values the probability of "yes" (0–1).
   */
  nouls(
    state: Readonly<Record<string, unknown>>,
    questions: Readonly<Record<string, string>>
  ): Promise<Readonly<Record<string, number>>>;
  /** False when no API key is configured: callers skip soft rules instead of failing. */
  available(): boolean;
}
