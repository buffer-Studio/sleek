export interface ServiceKey<T> {
  readonly id: string;
  readonly _type?: T;
}

export function createServiceKey<T>(id: string): ServiceKey<T> {
  return {id};
}
