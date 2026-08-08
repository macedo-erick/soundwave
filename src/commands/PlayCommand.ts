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
 * The reply is a card either way: "Now playing" when the track starts at once,
 * "Added to queue" when it is queued behind something. The trackStart listener
 * skips its own announcement in the first case to avoid posting a duplicate.
 *
 * The query is resolved before the bot joins the voice channel, so a dead link
 * fails cleanly rather than leaving it connected and idle.
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

    // Resolved before the bot joins anything: a query that cannot be played
    // must never leave it sitting in a voice channel with an empty queue.
    const query = interaction.options.getString('query', true);
    const resolution = await players.resolve(query, interaction.user);

    const player = await players.getOrCreate({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
    });

    const { startedImmediately, positionInQueue } = await player.enqueue(resolution);

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
      ? EmbedFactory.trackStarted(track, player.queueLength)
      : EmbedFactory.trackAdded(track, positionInQueue);

    await interaction.editReply({ embeds: [embed] });
  }
}
