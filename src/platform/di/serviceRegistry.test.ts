import {describe, expect, it} from 'bun:test';

import {createServiceKey} from './serviceKey';
import {ServiceRegistry} from './serviceRegistry';
import {TestServiceRegistry} from './testServiceRegistry';

describe('ServiceRegistry', () => {
  it('registers and resolves typed services and rejects duplicates', () => {
    const key = createServiceKey<{readonly name: string}>('test.service');
    const registry = new ServiceRegistry();

    registry.register(key, {name: 'sleek'});
    expect(registry.has(key)).toBe(true);
    expect(registry.resolve(key).name).toBe('sleek');
    expect(() => {
      registry.register(key, {name: 'dup'});
    }).toThrow('Service already registered');
  });

  it('allows TestServiceRegistry.override for offline test doubles', () => {
    const key = createServiceKey<{readonly value: number}>('test.override');
    const registry = new TestServiceRegistry();

    registry.register(key, {value: 1});
    registry.override(key, {value: 2});
    expect(registry.resolve(key).value).toBe(2);
  });
});
