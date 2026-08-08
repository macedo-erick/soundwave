import { SlashCommandBuilder } from 'discord.js';
import { Command, type CommandContext, type CommandData } from '../core/Command.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';
import { Format } from '../ui/Format.js';

/** Resumes playback after a pause. */
export class ResumeCommand extends Command {
  public readonly name = 'resume';
  public override readonly deferReply = true;

  public readonly data: CommandData = new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume a paused track');

  public async execute({ interaction, players }: CommandContext): Promise<void> {
    players.assertCanControl(interaction.member);

    const player = players.require(interaction.guildId);
    const track = await player.resume();

    await interaction.editReply({
      embeds: [
        EmbedFactory.success(`Resumed ${Format.trackLink(track.info.title, track.info.uri, 60)}`),
      ],
    });
  }
}
