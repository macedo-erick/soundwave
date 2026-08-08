import type { LavalinkNode } from 'lavalink-client';
import { TrackResolutionError } from '../errors/AppError.js';
import type { Logger } from '../logging/Logger.js';
import type { AnyTrack, ResolvedQuery } from './types.js';

/**
 * Turns a raw `/play` argument into playable tracks.
 *
 * Strategy lives on the Lavalink side: a bare URL is loaded directly, anything
 * else is searched on the default platform. Spotify links resolve through the
 * LavaSrc plugin, which reads Spotify metadata and plays the matching audio
 * from YouTube — Spotify audio itself is DRM-protected and cannot be streamed.
 *
 * Resolution deliberately runs against a node rather than a player, so a query
 * can be validated before the bot ever joins a voice channel.
 */
export class TrackResolver {
  constructor(private readonly logger: Logger) {}

  /**
   * Resolves a query, throwing a user-facing error if nothing is playable.
   * A search yields many candidates; only the top match is queued.
   */
  public async resolve(
    node: LavalinkNode,
    query: string,
    requester: unknown,
  ): Promise<ResolvedQuery> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      throw new TrackResolutionError('Give me something to play.');
    }

    const result = await node.search({ query: trimmed }, requester);

    switch (result.loadType) {
      case 'empty':
        throw new TrackResolutionError(
          `No results for **${truncateForMessage(trimmed)}**.`,
          'Try a different search term, or paste a direct link.',
        );

      case 'error': {
        const cause = result.exception?.message ?? 'unknown error';
        this.logger.warn('Lavalink failed to load a query', { query: trimmed, cause });
        throw new TrackResolutionError(
          "I couldn't load that track.",
          'The link may be private, region-locked, or age-restricted.',
        );
      }

      case 'playlist': {
        const tracks = result.tracks as AnyTrack[];
        if (tracks.length === 0) {
          throw new TrackResolutionError('That playlist is empty.');
        }
        return {
          kind: 'playlist',
          tracks,
          playlistName: result.playlist?.name ?? 'Unknown playlist',
        };
      }

      case 'track':
      case 'search':
      default: {
        const tracks = result.tracks as AnyTrack[];
        const first = tracks[0];
        if (!first) {
          throw new TrackResolutionError(`No results for **${truncateForMessage(trimmed)}**.`);
        }
        return { kind: 'track', tracks: [first] };
      }
    }
  }
}

function truncateForMessage(text: string): string {
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}
