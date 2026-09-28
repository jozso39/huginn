import pino from 'pino';
import type { IConfig } from './config';

export type Logger = pino.Logger;

export const createLogger = (config: Pick<IConfig, 'logLevel' | 'env'>): Logger =>
  pino({
    level: config.logLevel,
    // pino-pretty is a devDependency; production logs stay JSON for journald.
    ...(config.env === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    // Never let a connector's raw payload or a token reach the log by accident.
    redact: ['secrets', '*.secrets', 'token', '*.token', 'authorization', '*.authorization'],
  });
