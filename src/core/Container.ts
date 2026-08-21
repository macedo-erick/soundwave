import { Bot } from './Bot.js';
import { CommandRegistry } from './CommandRegistry.js';
import { EventRegistry } from './EventRegistry.js';
import type { Config } from '../config/Config.js';
import { ErrorHandler } from '../errors/ErrorHandler.js';
import { Logger } from '../logging/Logger.js';
import { GuildPlayerManager } from '../music/GuildPlayerManager.js';
import { LavalinkService } from '../music/LavalinkService.js';
import { TrackResolver } from '../music/TrackResolver.js';
import { InteractionCreateEvent } from '../events/InteractionCreateEvent.js';
import { ReadyEvent } from '../events/ReadyEvent.js';
import { VoiceStateUpdateEvent } from '../events/VoiceStateUpdateEvent.js';
import { ClearCommand } from '../commands/ClearCommand.js';
import { NowPlayingCommand } from '../commands/NowPlayingCommand.js';
import { PauseCommand } from '../commands/PauseCommand.js';
import { PlayCommand } from '../commands/PlayCommand.js';
import { QueueCommand } from '../commands/QueueCommand.js';
import { ResumeCommand } from '../commands/ResumeCommand.js';
import { ShuffleCommand } from '../commands/ShuffleCommand.js';
import { SkipCommand } from '../commands/SkipCommand.js';
import { StopCommand } from '../commands/StopCommand.js';

/**
 * Composition root: constructs every service and wires the dependency graph.
 *
 * Nothing else in the codebase constructs its own collaborators, which is what
 * keeps the rest of the classes injectable and testable.
 */
export class Container {
  public readonly config: Config;
  public readonly logger: Logger;
  public readonly bot: Bot;
  public readonly lavalinkService: LavalinkService;
  public readonly players: GuildPlayerManager;
  public readonly commands: CommandRegistry;
  public readonly events: EventRegistry;
  private readonly errorHandler: ErrorHandler;

  constructor(config: Config) {
    this.config = config;
    this.logger = Logger.create(config);
    this.errorHandler = new ErrorHandler(this.logger);

    this.bot = new Bot(config, this.logger);
    this.lavalinkService = new LavalinkService(this.bot.client, config, this.logger);

    const resolver = new TrackResolver(this.logger);
    this.players = new GuildPlayerManager(
      this.bot.client,
      this.lavalinkService,
      resolver,
      this.logger,
    );

    this.commands = new CommandRegistry(
      config,
      this.logger,
      this.errorHandler,
      this.players,
    ).register(
      new PlayCommand(),
      new SkipCommand(),
      new PauseCommand(),
      new ResumeCommand(),
      new StopCommand(),
      new ShuffleCommand(),
      new QueueCommand(),
      new ClearCommand(),
      new NowPlayingCommand(),
    );

    this.events = new EventRegistry(this.bot.client, this.logger).register(
      new ReadyEvent(this.lavalinkService, this.commands, this.logger),
      new InteractionCreateEvent(this.commands),
      new VoiceStateUpdateEvent(this.players, this.logger, config.idleTimeoutMs),
    );
  }

  public async start(): Promise<void> {
    this.logger.info('Starting Soundwave', this.config.toRedactedJSON());

    this.lavalinkService.attachRawForwarder();
    this.players.registerPlayerEvents();
    this.events.attachAll();
    this.errorHandler.registerProcessHandlers(() => this.stop());

    await this.bot.login();
  }

  /** Tears everything down in reverse order. Safe to call more than once. */
  public async stop(): Promise<void> {
    this.lavalinkService.destroy();
    await this.bot.shutdown();
  }
}
