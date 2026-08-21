import type { Client, ClientEvents } from 'discord.js';
import type { Logger } from '../logging/Logger.js';

/**
 * One Discord gateway event handler.
 *
 * Handlers must not throw: the gateway has nobody to report a failure to, so
 * `EventRegistry` catches and logs instead.
 */
export abstract class EventHandler<E extends keyof ClientEvents = keyof ClientEvents> {
  public abstract readonly event: E;
  public readonly once: boolean = false;

  public abstract handle(...args: ClientEvents[E]): Promise<void> | void;
}

/**
 * Binds event handlers to the Discord client (Observer pattern), wrapping each
 * one so a thrown handler logs rather than killing the process.
 */
export class EventRegistry {
  private readonly handlers: EventHandler[] = [];

  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  public register(...handlers: EventHandler[]): this {
    this.handlers.push(...handlers);
    return this;
  }

  public attachAll(): void {
    for (const handler of this.handlers) {
      const listener = (...args: unknown[]) => {
        void this.invoke(handler, args);
      };

      if (handler.once) {
        this.client.once(handler.event, listener);
      } else {
        this.client.on(handler.event, listener);
      }
    }

    this.logger.debug('Attached event handlers', {
      events: this.handlers.map((handler) => handler.event),
    });
  }

  private async invoke(handler: EventHandler, args: unknown[]): Promise<void> {
    try {
      await handler.handle(...(args as ClientEvents[keyof ClientEvents]));
    } catch (error) {
      this.logger.error(`Unhandled error in the ${handler.event} handler`, error);
    }
  }
}
