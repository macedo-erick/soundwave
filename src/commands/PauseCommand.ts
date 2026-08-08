import { SlashCommandBuilder } from 'discord.js';
import { Command, type CommandContext, type CommandData } from '../core/Command.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';
import { Format } from '../ui/Format.js';

/** Pauses playback, keeping the queue and position intact. */
export class PauseCommand extends Command {
  public readonly name = 'pause';
  public override readonly deferReply = true;

  public readonly data: CommandData = new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause the current track');

  public async execute({ interaction, players }: CommandContext): Promise<void> {
    players.assertCanControl(interaction.member);

    const player = players.require(interaction.guildId);
    const track = await player.pause();

    await interaction.editReply({
      embeds: [
        EmbedFactory.success(
          `Paused ${Format.trackLink(track.info.title, track.info.uri, 60)}. Use \`/resume\` to continue.`,
        ),
      ],
    });
  }
}
