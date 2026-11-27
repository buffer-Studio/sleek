export interface AsyncDisposable {
  disposeAsync: () => Promise<void>;
}

export class AsyncDisposableStore implements AsyncDisposable {
  private readonly items: AsyncDisposable[] = [];
  private disposed = false;

  public add<T extends AsyncDisposable>(item: T): T {
    if (this.disposed) {
      void item.disposeAsync();
      return item;
    }
    this.items.push(item);
    return item;
  }

  public async disposeAsync(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const item of this.items) {
      await item.disposeAsync();
    }
    this.items.length = 0;
  }
}
