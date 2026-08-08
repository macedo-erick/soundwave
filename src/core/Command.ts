import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import type { Logger } from '../logging/Logger.js';
import type { GuildPlayerManager } from '../music/GuildPlayerManager.js';

export type CommandData = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;

/**
 * Everything a command is allowed to touch. Passing a context rather than
 * reaching for module-level singletons is what makes commands unit-testable.
 */
export interface CommandContext {
  readonly interaction: ChatInputCommandInteraction<'cached'>;
  readonly players: GuildPlayerManager;
  readonly logger: Logger;
}

/**
 * Command pattern. One class per slash command; `CommandRegistry` deploys their
 * definitions to Discord and dispatches to `execute`.
 *
 * Implementations must NOT catch their own errors — throw a `UserFacingError`
 * and `ErrorHandler` turns it into the right reply.
 */
export abstract class Command {
  public abstract readonly name: string;
  public abstract readonly data: CommandData;

  /**
   * Set when the work may exceed Discord's 3-second reply deadline (anything
   * that hits Lavalink). Dispatch then defers the reply automatically.
   */
  public readonly deferReply: boolean = false;

  public abstract execute(context: CommandContext): Promise<void>;
}
