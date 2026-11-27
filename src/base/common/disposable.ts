export interface Disposable {
  dispose: () => void;
}

export function toDisposable(fn: () => void): Disposable {
  let disposed = false;
  return {
    dispose: (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      fn();
    },
  };
}

export class DisposableStore implements Disposable {
  private readonly items = new Set<Disposable>();
  private disposed = false;

  public add<T extends Disposable>(item: T): T {
    if (this.disposed) {
      item.dispose();
      return item;
    }
    this.items.add(item);
    return item;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const item of this.items) {
      item.dispose();
    }
    this.items.clear();
  }
}
