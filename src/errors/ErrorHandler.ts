import { MessageFlags, type RepliableInteraction } from 'discord.js';
import { AppError, SystemError } from './AppError.js';
import type { Logger } from '../logging/Logger.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';

/**
 * The single place that decides what a failure means.
 *
 * Commands deliberately contain no try/catch: they throw, dispatch catches, and
 * this class decides whether the user sees the real message or a generic one,
 * and at what log level it lands.
 */
export class ErrorHandler {
  constructor(private readonly logger: Logger) {}

  /**
   * Handles a failure raised while serving an interaction. Always resolves — a
   * failure inside error handling must never mask the original error.
   *
   * User-facing errors log at debug: they are expected outcomes of user input,
   * not defects, and would otherwise flood production logs.
   */
  public async handleInteractionError(
    error: unknown,
    interaction: RepliableInteraction,
    context: { commandName?: string } = {},
  ): Promise<void> {
    const normalized = ErrorHandler.normalize(error);
    const logger = this.logger.child({
      guildId: interaction.guildId ?? undefined,
      userId: interaction.user.id,
      interactionId: interaction.id,
      ...(context.commandName ? { commandName: context.commandName } : {}),
      errorCode: normalized.code,
    });

    if (normalized.isUserFacing) {
      logger.debug(`Rejected command: ${normalized.message}`);
    } else {
      logger.error('Command failed', normalized);
    }

    await this.reply(interaction, normalized);
  }

  /**
   * Wires process-level safety nets. An unhandled rejection leaves the process
   * in an unknown state, so we log and let the container restart us rather than
   * limping along with a half-broken player.
   */
  public registerProcessHandlers(onFatal: () => Promise<void>): void {
    const shutdown = (reason: string) => (error: unknown) => {
      this.logger.fatal(`Fatal: ${reason}`, error);
      void onFatal().finally(() => process.exit(1));
    };

    process.on('uncaughtException', shutdown('uncaught exception'));
    process.on('unhandledRejection', shutdown('unhandled rejection'));
  }

  /** Anything thrown becomes an AppError so downstream code has one shape. */
  public static normalize(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof Error) {
      return new SystemError(error.message, 'UNHANDLED', { cause: error });
    }
    return new SystemError(String(error), 'UNHANDLED');
  }

  /**
   * Reply on whichever channel is still open. An interaction may have been
   * deferred, already replied to, or expired entirely (tokens last 15 minutes),
   * so every path is guarded.
   */
  private async reply(interaction: RepliableInteraction, error: AppError): Promise<void> {
    const payload = {
      embeds: [EmbedFactory.error(error)],
      flags: MessageFlags.Ephemeral as const,
    };

    try {
      if (interaction.deferred) {
        await interaction.editReply({ embeds: payload.embeds });
      } else if (interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch (replyError) {
      this.logger.warn('Could not deliver the error message to Discord', {
        originalError: error.message,
        replyError: replyError instanceof Error ? replyError.message : String(replyError),
      });
    }
  }
}
