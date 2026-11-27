import type {ServiceKey} from './serviceKey';

export class ServiceRegistry {
  protected readonly services = new Map<string, unknown>();

  public register<T>(key: ServiceKey<T>, instance: T): void {
    if (this.services.has(key.id)) {
      throw new Error(`Service already registered for key: ${key.id}`);
    }
    this.services.set(key.id, instance);
  }

  public has<T>(key: ServiceKey<T>): boolean {
    return this.services.has(key.id);
  }

  public resolve<T>(key: ServiceKey<T>): T {
    if (!this.services.has(key.id)) {
      throw new Error(`No service registered for key: ${key.id}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return this.services.get(key.id) as T;
  }
}
