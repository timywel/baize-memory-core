// src/util/logger.ts
// 借鉴 hermes 风格 logger，按 LOG_LEVEL 过滤，支持 module 命名空间

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
export type Level = keyof typeof LEVELS;

const currentLevel: Level =
  (typeof process !== 'undefined' && process.env?.LOG_LEVEL as Level) || 'info';

function logAt(level: Level, module: string, msg: string, args: unknown[]): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${module}]`;
  const line = `${prefix} ${msg}`;
  if (level === 'error') console.error(line, ...args);
  else if (level === 'warn') console.warn(line, ...args);
  else console.log(line, ...args);
}

export function logger(module: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => logAt('debug', module, msg, args),
    info:  (msg: string, ...args: unknown[]) => logAt('info', module, msg, args),
    warn:  (msg: string, ...args: unknown[]) => logAt('warn', module, msg, args),
    error: (msg: string, ...args: unknown[]) => logAt('error', module, msg, args),
  };
}
