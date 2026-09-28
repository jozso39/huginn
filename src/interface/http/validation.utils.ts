import type { z } from 'zod';
import { ErrorCode, HuginnError } from '@/core/errors/errors';

export const parseBody = <T extends z.ZodType>(schema: T, body: unknown): z.output<T> => {
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new HuginnError(ErrorCode.Validation, 'invalid request body', result.error.issues);
  }

  return result.data;
};

export const parseQuery = <T extends z.ZodType>(schema: T, query: unknown): z.output<T> => {
  const result = schema.safeParse(query);

  if (!result.success) {
    throw new HuginnError(ErrorCode.Validation, 'invalid query', result.error.issues);
  }

  return result.data;
};
