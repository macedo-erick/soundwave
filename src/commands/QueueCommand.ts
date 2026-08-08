import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type Message,
} from 'discord.js';
import { Command, type CommandContext, type CommandData } from '../core/Command.js';
import { EmbedFactory, QUEUE_PAGE_SIZE } from '../ui/EmbedFactory.js';

const PAGINATION_TIMEOUT_MS = 120_000;

/**
 * Lists the queue, with buttons to page through it and to clear it.
 *
 * Pages are read from the live player on each turn rather than snapshotted, so
 * the list stays accurate while tracks finish during browsing.
 */
export class QueueCommand extends Command {
  public readonly name = 'queue';
  public override readonly deferReply = true;

  public readonly data: CommandData = new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the queued tracks');

  public async execute({ interaction, players, logger }: CommandContext): Promise<void> {
    const player = players.require(interaction.guildId);
    let page = 0;

    const totalPages = () => Math.max(1, Math.ceil(player.queueLength / QUEUE_PAGE_SIZE));

    const render = () => {
      const pages = totalPages();
      page = Math.min(page, pages - 1);
      return {
        embeds: [
          EmbedFactory.queuePage({
            current: player.current,
            tracks: player.pageOfQueue(page, QUEUE_PAGE_SIZE),
            page,
            totalPages: pages,
            totalTracks: player.queueLength,
            totalDuration: player.totalQueueDuration(),
          }),
        ],
        // The row is tied to having something to act on, not to page count —
        // otherwise a single-page queue would offer no way to clear it.
        components: player.queueLength > 0 ? [QueueCommand.buildControls(page, pages)] : [],
      };
    };

    const message = (await interaction.editReply(render())) as Message;
    if (player.queueLength === 0) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: PAGINATION_TIMEOUT_MS,
      filter: (button: ButtonInteraction) => button.user.id === interaction.user.id,
    });

    collector.on('collect', (button: ButtonInteraction) => {
      void (async () => {
        try {
          if (button.customId === 'queue:clear') {
            // Re-checked at press time: the user may have left the voice channel
            // since running the command.
            players.assertCanControl(interaction.member);
            await player.clearQueue();
            page = 0;
          } else {
            page = button.customId === 'queue:next' ? page + 1 : page - 1;
            page = Math.max(page, 0);
          }

          await button.update(render());

          if (player.queueLength === 0) {
            collector.stop('cleared');
          }
        } catch (error) {
          logger.debug('Queue button rejected', {
            customId: button.customId,
            error: error instanceof Error ? error.message : String(error),
          });
          await button.reply({
            embeds: [EmbedFactory.error(error)],
            flags: MessageFlags.Ephemeral,
          });
        }
      })().catch((error: unknown) => {
        logger.warn('Failed to handle a queue button', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    collector.on('end', (_collected, reason) => {
      if (reason === 'cleared') return;
      void interaction.editReply({ components: [] }).catch(() => {
        // The message may already be gone; nothing to clean up.
      });
    });
  }

  private static buildControls(page: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('queue:previous')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('queue:next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId('queue:clear')
        .setLabel('Clear queue')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
    );
  }
}
