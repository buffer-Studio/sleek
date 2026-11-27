export interface OkResult<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ErrResult<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = OkResult<T> | ErrResult<E>;

export function ok<T>(value: T): OkResult<T> {
  return {ok: true, value};
}

export function err<E>(error: E): ErrResult<E> {
  return {ok: false, error};
}
