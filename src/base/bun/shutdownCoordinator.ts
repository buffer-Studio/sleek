import type {ShutdownPhase} from './shutdownPhase';

export interface ShutdownHook {
  readonly name: string;
  readonly phase: ShutdownPhase;
  readonly run: () => Promise<void> | void;
}

export interface ShutdownError {
  readonly name: string;
  readonly message: string;
}

export interface ShutdownResult {
  readonly timedOut: boolean;
  readonly completed: readonly string[];
  readonly errors: readonly ShutdownError[];
}

export class ShutdownCoordinator {
  private readonly hooks: ShutdownHook[] = [];
  private runningPromise: Promise<ShutdownResult> | undefined;

  public register(hook: ShutdownHook): void {
    this.hooks.push(hook);
  }

  public async shutdown(timeoutMs = 12_000): Promise<ShutdownResult> {
    if (this.runningPromise !== undefined) {
      return this.runningPromise;
    }

    this.runningPromise = this.execute(timeoutMs);
    return this.runningPromise;
  }

  private async execute(timeoutMs: number): Promise<ShutdownResult> {
    const completed: string[] = [];
    const errors: ShutdownError[] = [];
    const sorted = [...this.hooks].sort((a, b) => a.phase - b.phase);

    const state = {timedOut: false};
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => {
        state.timedOut = true;
        resolve('timeout');
      }, timeoutMs);
      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }
    });

    const drainPromise = (async (): Promise<'done'> => {
      for (const hook of sorted) {
        if (state.timedOut) {
          break;
        }
        try {
          await hook.run();
          completed.push(hook.name);
        } catch (error: unknown) {
          errors.push({
            name: hook.name,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return 'done';
    })();

    await Promise.race([drainPromise, timeoutPromise]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }

    return {
      timedOut: state.timedOut,
      completed,
      errors,
    };
  }
}
