import pino from 'pino';
import type { Env } from '@jobsentinel/config';
import { loadEnv } from '@jobsentinel/config';
import { WorkerLoop } from './worker-loop';

describe('WorkerLoop', () => {
  const env: Env = loadEnv({ WORKER_TICK_MS: '1000' });
  const logger = pino({ level: 'silent' });

  it('runs exactly one tick in --once mode', async () => {
    const loop = new WorkerLoop(env);
    const tickSpy = jest.spyOn(loop as unknown as { tick: () => Promise<void> }, 'tick');
    await loop.run({ once: true, logger });
    expect(tickSpy).toHaveBeenCalledTimes(1);
  });

  it('a failing stage does not escape the loop', async () => {
    const loop = new WorkerLoop(env);
    jest
      .spyOn(loop as unknown as { tick: () => Promise<void> }, 'tick')
      .mockImplementationOnce(() => Promise.reject(new Error('boom')));
    // run() must surface the error only via the logger, never by rejecting
    await expect(loop.run({ once: true, logger })).resolves.toBeUndefined();
  });
});
