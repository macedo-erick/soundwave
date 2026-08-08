import { Client, GatewayIntentBits, Options } from 'discord.js';
import type { Config } from '../config/Config.js';
import type { Logger } from '../logging/Logger.js';

/**
 * Lifecycle facade over the discord.js client.
 *
 * Intents are deliberately minimal: the bot reads no message content, so it
 * needs only guild metadata and voice states, and stays free of privileged
 * intent review.
 */
export class Bot {
  public readonly client: Client;
  private shuttingDown = false;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
      // Voice state and channel caches are required for playback; the rest only
      // grow memory in a long-running process.
      makeCache: Options.cacheWithLimits({
        ...Options.DefaultMakeCacheSettings,
        MessageManager: 0,
        PresenceManager: 0,
        ReactionManager: 0,
        GuildMemberManager: { maxSize: 200 },
      }),
    });

    this.client.on('error', (error) => {
      this.logger.error('Discord client error', error);
    });

    this.client.on('shardError', (error, shardId) => {
      this.logger.error('Gateway shard error', error, { shardId });
    });

    this.client.on('warn', (message) => {
      this.logger.warn('Discord client warning', { message });
    });
  }

  public async login(): Promise<void> {
    await this.client.login(this.config.discord.token);
  }

  /** Closes the gateway connection. Safe to call more than once. */
  public async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    this.logger.info('Closing the Discord connection');
    await this.client.destroy();
  }
}
