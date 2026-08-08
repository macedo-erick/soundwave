import {
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Command } from './Command.js';
import type { Config } from '../config/Config.js';
import type { ErrorHandler } from '../errors/ErrorHandler.js';
import { UserFacingError } from '../errors/AppError.js';
import type { Logger } from '../logging/Logger.js';
import type { GuildPlayerManager } from '../music/GuildPlayerManager.js';

/**
 * Holds the command set, publishes it to Discord, and routes interactions to it.
 *
 * Registration is explicit rather than filesystem scanning: a bundled `dist/`
 * has no reliable directory to walk, and an explicit list fails at compile time
 * instead of silently registering nothing.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, Command>();

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly errorHandler: ErrorHandler,
    private readonly players: GuildPlayerManager,
  ) {}

  public register(...commands: Command[]): this {
    for (const command of commands) {
      if (this.commands.has(command.name)) {
        throw new Error(`Duplicate command name: ${command.name}`);
      }
      this.commands.set(command.name, command);
    }
    return this;
  }

  public get size(): number {
    return this.commands.size;
  }

  public get names(): string[] {
    return [...this.commands.keys()];
  }

  /**
   * Publishes command definitions to Discord.
   *
   * Development deploys to a single guild because guild commands appear
   * instantly, while global commands can take up to an hour to propagate.
   */
  public async deploy(): Promise<void> {
    const body: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [...this.commands.values()].map(
      (command) => command.data.toJSON(),
    );

    const rest = new REST({ version: '10' }).setToken(this.config.discord.token);
    const devGuildId = this.config.discord.devGuildId;
    const useGuildScope = Boolean(devGuildId) && !this.config.isProduction;

    const route =
      useGuildScope && devGuildId
        ? Routes.applicationGuildCommands(this.config.discord.clientId, devGuildId)
        : Routes.applicationCommands(this.config.discord.clientId);

    await rest.put(route, { body });
    this.logger.info(`Deployed ${body.length} commands (${useGuildScope ? 'guild' : 'global'})`, {
      commands: this.names,
      ...(useGuildScope ? { guildId: devGuildId } : {}),
    });
  }

  /**
   * Routes one interaction to its command. This is the only place command
   * errors are caught, so everything downstream is free to throw.
   *
   * Commands marked `deferReply` are deferred first: Lavalink round-trips
   * routinely exceed Discord's 3-second initial-response budget.
   */
  public async dispatch(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      this.logger.warn('Received an unknown command, likely stale after a redeploy', {
        commandName: interaction.commandName,
      });
      return;
    }

    const logger = this.logger.child({
      commandName: command.name,
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
      interactionId: interaction.id,
    });

    try {
      if (!interaction.inCachedGuild()) {
        throw new UserFacingError(
          'Music commands only work inside a server.',
          'GUILD_ONLY',
          'Invite me to a server and try again there.',
        );
      }

      if (command.deferReply && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      const startedAt = Date.now();
      await command.execute({ interaction, players: this.players, logger });
      logger.debug('Command completed', { durationMs: Date.now() - startedAt });
    } catch (error) {
      await this.errorHandler.handleInteractionError(error, interaction, {
        commandName: command.name,
      });
    }
  }
}
