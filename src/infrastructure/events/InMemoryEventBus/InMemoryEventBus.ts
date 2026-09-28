import type { Logger } from '@/lib/logger';
import { toError } from '@/core/errors/errors';
import type {
  EventHandler,
  HuginnEvent,
  IEventBus,
  Unsubscribe,
} from '@/core/events/EventBus.types';

export class InMemoryEventBus implements IEventBus {
  private readonly handlers = new Set<EventHandler>();

  constructor(private readonly logger: Logger) {}

  public publish(event: HuginnEvent): void {
    this.handlers.forEach((handler) => {
      // One broken SSE client must not stop the others from hearing the event.
      try {
        handler(event);
      } catch (error) {
        this.logger.warn({ err: toError(error), type: event.type }, 'event handler threw');
      }
    });
  }

  public subscribe(handler: EventHandler): Unsubscribe {
    this.handlers.add(handler);

    return () => {
      this.handlers.delete(handler);
    };
  }
}
