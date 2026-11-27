import {describe, expect, it} from 'bun:test';

import {ShutdownCoordinator} from './shutdownCoordinator';
import {ShutdownPhase} from './shutdownPhase';

describe('ShutdownCoordinator', () => {
  it('executes shutdown hooks strictly in phase order 0 -> 4', async () => {
    const coordinator = new ShutdownCoordinator();
    const order: string[] = [];

    coordinator.register({
      name: 'telemetry',
      phase: ShutdownPhase.Telemetry,
      run: () => {
        order.push('telemetry');
      },
    });
    coordinator.register({
      name: 'ingress',
      phase: ShutdownPhase.Ingress,
      run: () => {
        order.push('ingress');
      },
    });
    coordinator.register({
      name: 'native',
      phase: ShutdownPhase.NativeRuntime,
      run: () => {
        order.push('native');
      },
    });

    const result = await coordinator.shutdown(1000);
    expect(result.timedOut).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(order).toEqual(['ingress', 'native', 'telemetry']);
  });
});
