import { ActivityType, type ClientEvents } from 'discord.js';
import { EventHandler } from '../core/EventRegistry.js';
import type { CommandRegistry } from '../core/CommandRegistry.js';
import type { Logger } from '../logging/Logger.js';
import type { LavalinkService } from '../music/LavalinkService.js';

/**
 * Completes startup once the gateway is ready: initialises Lavalink with the
 * now-known user ID and publishes the command set.
 */
export class ReadyEvent extends EventHandler<'clientReady'> {
  public readonly event = 'clientReady' as const;
  public override readonly once = true;

  constructor(
    private readonly lavalinkService: LavalinkService,
    private readonly commands: CommandRegistry,
    private readonly logger: Logger,
  ) {
    super();
  }

  public async handle(...args: ClientEvents['clientReady']): Promise<void> {
    const [client] = args;

    this.logger.info(`Logged in as ${client.user.tag}`, {
      userId: client.user.id,
      guildCount: client.guilds.cache.size,
    });

    client.user.setPresence({
      activities: [{ name: '/play', type: ActivityType.Listening }],
      status: 'online',
    });

    await this.lavalinkService.init(client.user.id, client.user.username);
    await this.commands.deploy();

    this.logger.info('Soundwave is ready');
  }
}
