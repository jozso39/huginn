import pino from 'pino';
import type { IConfig } from './config';

export type Logger = pino.Logger;

export const createLogger = (config: Pick<IConfig, 'logLevel' | 'env' | 'desktop'>): Logger => {
  const options = {
    level: config.logLevel,
    // Never let a connector's raw payload or a token reach the log by accident.
    redact: ['secrets', '*.secrets', 'token', '*.token', 'authorization', '*.authorization'],
  };

  // In the Mac app stdout carries events to the shell, so logs go to stderr as JSON.
  if (config.desktop.enabled) {
    return pino(options, pino.destination(2));
  }

  // pino-pretty is a devDependency; production logs stay JSON.
  return pino({
    ...options,
    ...(config.env === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  });
};
