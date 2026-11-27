import type {ServiceKey} from './serviceKey';
import {ServiceRegistry} from './serviceRegistry';

export class TestServiceRegistry extends ServiceRegistry {
  public override<T>(key: ServiceKey<T>, instance: T): void {
    this.services.set(key.id, instance);
  }
}
