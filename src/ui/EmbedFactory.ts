import { EmbedBuilder } from 'discord.js';
import type { Track } from 'lavalink-client';
import { AppError } from '../errors/AppError.js';
import { type AnyTrack, requesterOf } from '../music/types.js';
import { Format } from './Format.js';

/** Single source of truth for the bot's visual language. */
const Colors = {
  primary: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  neutral: 0x2b2d31,
} as const;

export interface NowPlayingView {
  readonly track: Track;
  readonly position: number;
  readonly paused: boolean;
  readonly volume: number;
  readonly queueLength: number;
}

export interface QueuePageView {
  readonly current: Track | null;
  readonly tracks: AnyTrack[];
  readonly page: number;
  readonly totalPages: number;
  readonly totalTracks: number;
  readonly totalDuration: number;
}

/**
 * Builds every embed the bot sends. Commands never construct embeds inline, so
 * restyling the bot is a change to this one file.
 */
export class EmbedFactory {
  public static error(error: unknown): EmbedBuilder {
    const isKnown = error instanceof AppError && error.isUserFacing;
    const message = isKnown
      ? error.message
      : 'Something went wrong on my end. It has been logged — please try again.';

    const embed = new EmbedBuilder().setColor(Colors.danger).setDescription(`❌ ${message}`);

    if (isKnown && error instanceof AppError && 'hint' in error && typeof error.hint === 'string') {
      embed.setFooter({ text: error.hint });
    }
    return embed;
  }

  public static success(message: string): EmbedBuilder {
    return new EmbedBuilder().setColor(Colors.success).setDescription(`✅ ${message}`);
  }

  public static info(message: string): EmbedBuilder {
    return new EmbedBuilder().setColor(Colors.primary).setDescription(message);
  }

  public static warning(message: string): EmbedBuilder {
    return new EmbedBuilder().setColor(Colors.warning).setDescription(`⚠️ ${message}`);
  }

  public static trackAdded(track: AnyTrack, positionInQueue: number): EmbedBuilder {
    const { info } = track;
    const embed = new EmbedBuilder()
      .setColor(Colors.success)
      .setAuthor({ name: 'Added to queue' })
      .setDescription(Format.trackLink(info.title, info.uri, 70))
      .addFields(
        {
          name: 'Duration',
          value: Format.duration(info.duration ?? 0, info.isStream ?? false),
          inline: true,
        },
        { name: 'Source', value: Format.source(info.sourceName), inline: true },
        { name: 'Position', value: `#${positionInQueue}`, inline: true },
      );

    if (info.artworkUrl) embed.setThumbnail(info.artworkUrl);
    EmbedFactory.applyRequesterFooter(embed, track);
    return embed;
  }

  public static playlistAdded(
    playlistName: string,
    trackCount: number,
    totalDuration: number,
    requestedBy: AnyTrack | undefined,
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(Colors.success)
      .setAuthor({ name: 'Playlist added to queue' })
      .setDescription(Format.truncate(playlistName, 80))
      .addFields(
        { name: 'Tracks', value: `${trackCount}`, inline: true },
        { name: 'Duration', value: Format.longDuration(totalDuration), inline: true },
      );

    if (requestedBy) EmbedFactory.applyRequesterFooter(embed, requestedBy);
    return embed;
  }

  public static nowPlaying(view: NowPlayingView): EmbedBuilder {
    const { track, position, paused, volume, queueLength } = view;
    const { info } = track;
    const isStream = info.isStream;

    const bar = isStream
      ? '🔴 Live stream'
      : `${Format.progressBar(position, info.duration)}\n\`${Format.duration(position)} / ${Format.duration(info.duration)}\``;

    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setAuthor({ name: paused ? 'Paused' : 'Now playing' })
      .setDescription(`${Format.trackLink(info.title, info.uri, 70)}\n\n${bar}`)
      .addFields(
        { name: 'Artist', value: Format.truncate(info.author || 'Unknown', 40), inline: true },
        { name: 'Source', value: Format.source(info.sourceName), inline: true },
        { name: 'Volume', value: `${volume}%`, inline: true },
      );

    if (queueLength > 0) {
      embed.addFields({
        name: 'Up next',
        value: `${queueLength} track${queueLength === 1 ? '' : 's'} queued`,
        inline: true,
      });
    }
    if (info.artworkUrl) embed.setThumbnail(info.artworkUrl);
    EmbedFactory.applyRequesterFooter(embed, track);
    return embed;
  }

  public static queuePage(view: QueuePageView): EmbedBuilder {
    const { current, tracks, page, totalPages, totalTracks, totalDuration } = view;
    const offset = page * QUEUE_PAGE_SIZE;

    const lines = tracks.map((track, index) => {
      const requester = requesterOf(track);
      const by = requester ? ` — ${requester.displayName}` : '';
      return (
        `\`${offset + index + 1}.\` ${Format.trackLink(track.info.title, track.info.uri, 45)} ` +
        `\`${Format.duration(track.info.duration ?? 0, track.info.isStream ?? false)}\`${by}`
      );
    });

    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setTitle('Queue')
      .setDescription(lines.length > 0 ? lines.join('\n') : '*The queue is empty.*')
      .setFooter({
        text:
          `Page ${page + 1}/${Math.max(totalPages, 1)} • ` +
          `${totalTracks} track${totalTracks === 1 ? '' : 's'} • ` +
          `${Format.longDuration(totalDuration)} total`,
      });

    if (current) {
      embed.addFields({
        name: 'Now playing',
        value: Format.trackLink(current.info.title, current.info.uri, 60),
      });
    }
    return embed;
  }

  private static applyRequesterFooter(embed: EmbedBuilder, track: AnyTrack): void {
    const requester = requesterOf(track);
    if (!requester) return;
    embed.setFooter({
      text: `Requested by ${requester.displayName}`,
      ...(requester.avatarUrl ? { iconURL: requester.avatarUrl } : {}),
    });
  }
}

/** Tracks listed per `/queue` page. */
export const QUEUE_PAGE_SIZE = 10;
