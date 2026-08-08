import { SlashCommandBuilder } from 'discord.js';
import { Command, type CommandContext, type CommandData } from '../core/Command.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';

/** Shows the current track with a progress bar and queue summary. */
export class NowPlayingCommand extends Command {
  public readonly name = 'nowplaying';
  public override readonly deferReply = true;

  public readonly data: CommandData = new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show what is playing right now');

  public async execute({ interaction, players }: CommandContext): Promise<void> {
    const player = players.require(interaction.guildId);
    const track = player.requireCurrent();

    await interaction.editReply({
      embeds: [
        EmbedFactory.nowPlaying({
          track,
          position: player.position,
          paused: player.isPaused,
          volume: player.volume,
          queueLength: player.queueLength,
        }),
      ],
    });
  }
}
