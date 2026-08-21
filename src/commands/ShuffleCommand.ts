import { SlashCommandBuilder } from 'discord.js';
import { Command, type CommandContext, type CommandData } from '../core/Command.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';

export class ShuffleCommand extends Command {
  public readonly name = 'shuffle';
  public override readonly deferReply = true;

  public readonly data: CommandData = new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the queued tracks');

  public async execute({ interaction, players }: CommandContext): Promise<void> {
    players.assertCanControl(interaction.member);

    const player = players.require(interaction.guildId);
    const shuffled = await player.shuffle();

    await interaction.editReply({
      embeds: [EmbedFactory.success(`Shuffled ${shuffled} queued tracks.`)],
    });
  }
}
