import {type Disposable, toDisposable} from '../../base/common/disposable';
import type {StructuredLogger} from '../../platform/logger/structuredLogger';
import type {GatewayBatch} from '../ports/gateway.port';
import {
  type GatewayDomainEvent,
  type GatewayEventType,
  isKnownGatewayEventType,
  parseGatewayDomainEvent,
} from './gatewayEvents';

export type ProjectionEventHandler<TType extends GatewayEventType> = (
  event: Extract<GatewayDomainEvent, {readonly type: TType}>,
) => void;

export type AsyncEventHandler<TType extends GatewayEventType> = (
  event: Extract<GatewayDomainEvent, {readonly type: TType}>,
) => Promise<void> | void;

export interface EventBus {
  readonly subscribeProjection: <TType extends GatewayEventType>(
    eventType: TType,
    handler: ProjectionEventHandler<TType>,
  ) => Disposable;
  readonly subscribe: <TType extends GatewayEventType>(
    eventType: TType,
    handler: AsyncEventHandler<TType>,
  ) => Disposable;
  readonly publishRawBatch: (batch: GatewayBatch) => Promise<void>;
}

type AnyProjectionHandler = (event: GatewayDomainEvent) => void;
type AnyAsyncHandler = (event: GatewayDomainEvent) => Promise<void> | void;

export function createEventBus(logger?: StructuredLogger): EventBus {
  const projectionHandlers = new Map<GatewayEventType, Set<AnyProjectionHandler>>();
  const asyncHandlers = new Map<GatewayEventType, Set<AnyAsyncHandler>>();

  function hasSubscribers(eventType: string): eventType is GatewayEventType {
    if (!isKnownGatewayEventType(eventType)) {
      return false;
    }
    const projSize = projectionHandlers.get(eventType)?.size ?? 0;
    const asyncSize = asyncHandlers.get(eventType)?.size ?? 0;
    return projSize > 0 || asyncSize > 0;
  }

  return {
    subscribeProjection: <TType extends GatewayEventType>(
      eventType: TType,
      handler: ProjectionEventHandler<TType>,
    ): Disposable => {
      let set = projectionHandlers.get(eventType);
      if (set === undefined) {
        set = new Set();
        projectionHandlers.set(eventType, set);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const wrapped = handler as unknown as AnyProjectionHandler;
      set.add(wrapped);
      return toDisposable(() => {
        set.delete(wrapped);
      });
    },
    subscribe: <TType extends GatewayEventType>(
      eventType: TType,
      handler: AsyncEventHandler<TType>,
    ): Disposable => {
      let set = asyncHandlers.get(eventType);
      if (set === undefined) {
        set = new Set();
        asyncHandlers.set(eventType, set);
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const wrapped = handler as unknown as AnyAsyncHandler;
      set.add(wrapped);
      return toDisposable(() => {
        set.delete(wrapped);
      });
    },
    publishRawBatch: async (batch: GatewayBatch): Promise<void> => {
      const pendingAsync: Array<Promise<void>> = [];

      for (const rawEvent of batch.events) {
        if (!hasSubscribers(rawEvent.eventType)) {
          continue;
        }
        const domainEvent = parseGatewayDomainEvent(
          rawEvent.eventType,
          rawEvent.platform,
          rawEvent.shardId,
          rawEvent.rawJson,
        );
        if (domainEvent === undefined) {
          continue;
        }

        // phase 1: synchronous pre-dispatch projections (ordered within batch)
        const projections = projectionHandlers.get(domainEvent.type);
        if (projections !== undefined) {
          for (const handler of projections) {
            try {
              handler(domainEvent);
            } catch (error: unknown) {
              logger?.error('event_bus.projection_error', {
                eventType: domainEvent.type,
                platform: domainEvent.platform,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }

        // phase 2: async module fan-out
        const subscribers = asyncHandlers.get(domainEvent.type);
        if (subscribers !== undefined) {
          for (const handler of subscribers) {
            pendingAsync.push(
              (async () => {
                try {
                  await handler(domainEvent);
                } catch (error: unknown) {
                  logger?.error('event_bus.subscriber_error', {
                    eventType: domainEvent.type,
                    platform: domainEvent.platform,
                    message: error instanceof Error ? error.message : String(error),
                  });
                }
              })(),
            );
          }
        }
      }

      if (pendingAsync.length > 0) {
        await Promise.allSettled(pendingAsync);
      }
    },
  };
}
