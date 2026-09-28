export enum ErrorCode {
  NotFound = 'NotFound',
  Validation = 'Validation',
  Unsupported = 'Unsupported',
  Upstream = 'Upstream',
  Unauthorized = 'Unauthorized',
}

export class HuginnError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HuginnError';
  }
}

export const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));
