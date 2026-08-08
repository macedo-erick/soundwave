import { SlashCommandBuilder } from 'discord.js';
import { Command, type CommandContext, type CommandData } from '../core/Command.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';

/**
 * Empties the queue without interrupting the current track — the difference
 * from `/stop`, which also clears the queue but disconnects as well.
 */
export class ClearCommand extends Command {
  public readonly name = 'clear';
  public override readonly deferReply = true;

  public readonly data: CommandData = new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Remove every queued track, keeping the current one playing');

  public async execute({ interaction, players }: CommandContext): Promise<void> {
    players.assertCanControl(interaction.member);

    const player = players.require(interaction.guildId);
    const removed = await player.clearQueue();
    const current = player.current;

    const suffix = current ? ` Still playing **${current.info.title}**.` : '';
    await interaction.editReply({
      embeds: [
        EmbedFactory.success(
          `Cleared ${removed} track${removed === 1 ? '' : 's'} from the queue.${suffix}`,
        ),
      ],
    });
  }
}
