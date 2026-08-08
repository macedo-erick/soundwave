import { SlashCommandBuilder } from 'discord.js';
import { Command, type CommandContext, type CommandData } from '../core/Command.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';

/** Clears the queue, stops playback, and leaves the voice channel. */
export class StopCommand extends Command {
  public readonly name = 'stop';
  public override readonly deferReply = true;

  public readonly data: CommandData = new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue, and leave the voice channel');

  public async execute({ interaction, players }: CommandContext): Promise<void> {
    players.assertCanControl(interaction.member);

    const player = players.require(interaction.guildId);
    const cleared = player.queueLength;
    await player.stop();

    await interaction.editReply({
      embeds: [
        EmbedFactory.success(
          cleared > 0
            ? `Stopped playback and cleared ${cleared} queued track${cleared === 1 ? '' : 's'}.`
            : 'Stopped playback and left the voice channel.',
        ),
      ],
    });
  }
}
