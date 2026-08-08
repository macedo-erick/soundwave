import { SlashCommandBuilder } from 'discord.js';
import { Command, type CommandContext, type CommandData } from '../core/Command.js';
import { UserFacingError } from '../errors/AppError.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';

/**
 * Queues a track, playlist, or search result.
 *
 * Accepts YouTube and Spotify links as well as free-text search. Spotify links
 * resolve via LavaSrc, which reads the metadata and plays matching audio from
 * YouTube — Spotify's own streams are DRM-protected and cannot be played.
 *
 * A track that starts playing immediately is acknowledged briefly, because the
 * trackStart listener already posts the full now-playing embed.
 */
export class PlayCommand extends Command {
  public readonly name = 'play';
  public override readonly deferReply = true;

  public readonly data: CommandData = new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track from YouTube or Spotify, or search by name')
    .addStringOption((option) =>
      option
        .setName('query')
        .setDescription('A YouTube/Spotify link, or search terms')
        .setRequired(true)
        .setMaxLength(500),
    );

  public async execute({ interaction, players }: CommandContext): Promise<void> {
    const voiceChannel = players.assertCanControl(interaction.member);

    if (!interaction.channel?.isTextBased()) {
      throw new UserFacingError('I need a text channel to post updates in.', 'CHANNEL_UNSUPPORTED');
    }

    const player = await players.getOrCreate({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
    });

    const query = interaction.options.getString('query', true);
    const { resolution, startedImmediately, positionInQueue } = await player.enqueue(
      query,
      interaction.user,
    );

    if (resolution.kind === 'playlist') {
      const total = resolution.tracks.reduce((sum, track) => sum + (track.info.duration ?? 0), 0);
      await interaction.editReply({
        embeds: [
          EmbedFactory.playlistAdded(
            resolution.playlistName ?? 'Playlist',
            resolution.tracks.length,
            total,
            resolution.tracks[0],
          ),
        ],
      });
      return;
    }

    const track = resolution.tracks[0];
    if (!track) {
      throw new UserFacingError('That query produced nothing playable.', 'EMPTY_RESOLUTION');
    }

    const embed = startedImmediately
      ? EmbedFactory.success(`Playing **${track.info.title}**`)
      : EmbedFactory.trackAdded(track, positionInQueue);

    await interaction.editReply({ embeds: [embed] });
  }
}
