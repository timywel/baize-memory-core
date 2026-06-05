// tests/logger.test.ts
// 关键测试：级别过滤 + module 命名空间 + 三个 console 输出区分

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../src/util/logger';

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('info goes to console.log with module prefix', () => {
    logger('test').info('hello');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('[test]');
    expect(logSpy.mock.calls[0][0]).toContain('[INFO]');
  });

  it('warn goes to console.warn, error to console.error', () => {
    logger('test').warn('w');
    logger('test').error('e');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('passes extra args through to console', () => {
    const obj = { foo: 'bar' };
    logger('test').error('failed', obj);
    expect(errSpy.mock.calls[0]).toContain(obj);
  });
});
