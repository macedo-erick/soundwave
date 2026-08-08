import { SlashCommandBuilder } from 'discord.js';
import { Command, type CommandContext, type CommandData } from '../core/Command.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';
import { Format } from '../ui/Format.js';

/** Skips the current track and advances to the next queued one. */
export class SkipCommand extends Command {
  public readonly name = 'skip';
  public override readonly deferReply = true;

  public readonly data: CommandData = new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the track that is currently playing');

  public async execute({ interaction, players }: CommandContext): Promise<void> {
    players.assertCanControl(interaction.member);

    const player = players.require(interaction.guildId);
    const skipped = await player.skip();
    const remaining = player.queueLength;

    const suffix = remaining > 0 ? '' : ' — the queue is now empty.';
    await interaction.editReply({
      embeds: [
        EmbedFactory.success(
          `Skipped ${Format.trackLink(skipped.info.title, skipped.info.uri, 60)}${suffix}`,
        ),
      ],
    });
  }
}
