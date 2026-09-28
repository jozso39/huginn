import type { IJevClient } from '@/core/clients/JevClient/JevClient.types';

export type JevAnswer = (state: Readonly<Record<string, unknown>>, question: string) => number;

/**
 * Answers every question with `answer`, which tests replace. The default says
 * "no" to everything, so soft rules stay silent unless a test wants them to fire.
 */
export class MockJevClient implements IJevClient {
  public answer: JevAnswer = () => 0.1;
  public calls = 0;
  public isAvailable = true;

  public available(): boolean {
    return this.isAvailable;
  }

  public nouls(
    state: Readonly<Record<string, unknown>>,
    questions: Readonly<Record<string, string>>
  ): Promise<Readonly<Record<string, number>>> {
    this.calls += 1;

    return Promise.resolve(
      Object.fromEntries(
        Object.entries(questions).map(([key, question]) => [key, this.answer(state, question)])
      )
    );
  }
}
