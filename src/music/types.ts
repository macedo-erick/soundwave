import type { Track, UnresolvedTrack } from 'lavalink-client';

/**
 * lavalink-client types `Track.requester` as an empty interface and passes it
 * through untouched. We normalise it to this shape in a `requesterTransformer`
 * so a full discord.js User never ends up serialised into a persisted queue.
 */
export interface Requester {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export type AnyTrack = Track | UnresolvedTrack;

export type ResolutionKind = 'track' | 'playlist';

export interface ResolvedQuery {
  readonly kind: ResolutionKind;
  readonly tracks: AnyTrack[];
  readonly playlistName?: string;
}

/** Narrows `Track.requester`, typed `{}` upstream, back to our known shape. */
export function requesterOf(track: AnyTrack): Requester | null {
  const requester = track.requester as Partial<Requester> | undefined;
  if (!requester || typeof requester.id !== 'string') return null;
  return {
    id: requester.id,
    username: requester.username ?? 'Unknown',
    displayName: requester.displayName ?? requester.username ?? 'Unknown',
    avatarUrl: requester.avatarUrl ?? null,
  };
}
