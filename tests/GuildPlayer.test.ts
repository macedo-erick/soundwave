import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player, Track } from 'lavalink-client';
import { GuildPlayer } from '../src/music/GuildPlayer.js';
import { QueueError } from '../src/errors/AppError.js';
import { Logger } from '../src/logging/Logger.js';
import type { TrackResolver } from '../src/music/TrackResolver.js';
import { pino } from 'pino';

const silentLogger = Logger.fromPino(pino({ level: 'silent' }));

function makeTrack(title: string): Track {
  return {
    encoded: `enc-${title}`,
    info: {
      identifier: title,
      title,
      author: 'Artist',
      duration: 200_000,
      artworkUrl: null,
      uri: `https://example.com/${title}`,
      sourceName: 'youtube',
      isSeekable: true,
      isStream: false,
      isrc: null,
    },
    pluginInfo: {},
  };
}

function makePlayer(overrides: Record<string, unknown> = {}) {
  const tracks: Track[] = [];
  return {
    guildId: 'guild-1',
    voiceChannelId: 'voice-1',
    playing: false,
    paused: false,
    position: 0,
    volume: 100,
    connected: true,
    queue: {
      current: null as Track | null,
      tracks,
      add: vi.fn().mockResolvedValue(undefined),
      shuffle: vi.fn().mockResolvedValue(tracks.length),
      getTracks: vi.fn((start: number, end: number) => tracks.slice(start, end)),
      splice: vi.fn().mockResolvedValue(undefined),
      utils: { totalDuration: vi.fn(() => 0) },
    },
    play: vi.fn().mockResolvedValue(undefined),
    skip: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    stopPlaying: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function build(playerOverrides: Record<string, unknown> = {}) {
  const raw = makePlayer(playerOverrides);
  const resolver = {
    resolve: vi.fn().mockResolvedValue({ kind: 'track', tracks: [makeTrack('Song')] }),
  } as unknown as TrackResolver;
  const player = new GuildPlayer(raw as unknown as Player, resolver, silentLogger);
  return { player, raw, resolver };
}

describe('GuildPlayer enqueue', () => {
  it('starts playback when the player is idle', async () => {
    const { player, raw } = build();

    const result = await player.enqueue('a song', { id: 'u1' });

    expect(raw.queue.add).toHaveBeenCalledOnce();
    expect(raw.play).toHaveBeenCalledOnce();
    expect(result.startedImmediately).toBe(true);
  });

  it('only queues when something is already playing', async () => {
    const { player, raw } = build({ playing: true });

    const result = await player.enqueue('a song', { id: 'u1' });

    expect(raw.queue.add).toHaveBeenCalledOnce();
    expect(raw.play).not.toHaveBeenCalled();
    expect(result.startedImmediately).toBe(false);
  });

  it('does not restart playback while paused', async () => {
    const { player, raw } = build({ playing: false, paused: true });

    await player.enqueue('a song', { id: 'u1' });

    expect(raw.play).not.toHaveBeenCalled();
  });
});

describe('GuildPlayer transport controls', () => {
  let context: ReturnType<typeof build>;

  beforeEach(() => {
    context = build();
  });

  it('refuses to skip when nothing is playing', async () => {
    await expect(context.player.skip()).rejects.toThrowError(QueueError);
  });

  it('stops rather than skipping the final track', async () => {
    const { player, raw } = build();
    raw.queue.current = makeTrack('Last');

    const skipped = await player.skip();

    expect(skipped.info.title).toBe('Last');
    expect(raw.stopPlaying).toHaveBeenCalledOnce();
    expect(raw.skip).not.toHaveBeenCalled();
  });

  it('skips normally when tracks remain', async () => {
    const { player, raw } = build();
    raw.queue.current = makeTrack('Current');
    raw.queue.tracks.push(makeTrack('Next'));

    await player.skip();

    expect(raw.skip).toHaveBeenCalledOnce();
    expect(raw.stopPlaying).not.toHaveBeenCalled();
  });

  it('rejects pausing when already paused', async () => {
    const { player, raw } = build({ paused: true });
    raw.queue.current = makeTrack('Current');

    await expect(player.pause()).rejects.toThrowError(QueueError);
  });

  it('rejects resuming when not paused', async () => {
    const { player, raw } = build();
    raw.queue.current = makeTrack('Current');

    await expect(player.resume()).rejects.toThrowError(QueueError);
  });

  it('pauses a playing track', async () => {
    const { player, raw } = build();
    raw.queue.current = makeTrack('Current');

    await player.pause();

    expect(raw.pause).toHaveBeenCalledOnce();
  });

  it('destroys the player and disconnects on stop', async () => {
    const { player, raw } = build();

    await player.stop();

    expect(raw.destroy).toHaveBeenCalledWith(expect.any(String), true);
  });
});

describe('GuildPlayer shuffle', () => {
  it('refuses to shuffle fewer than two queued tracks', async () => {
    const { player, raw } = build();
    raw.queue.tracks.push(makeTrack('Only'));

    await expect(player.shuffle()).rejects.toThrowError(QueueError);
    expect(raw.queue.shuffle).not.toHaveBeenCalled();
  });

  it('shuffles once there are at least two queued tracks', async () => {
    const { player, raw } = build();
    raw.queue.tracks.push(makeTrack('One'), makeTrack('Two'));

    const count = await player.shuffle();

    expect(raw.queue.shuffle).toHaveBeenCalledOnce();
    expect(count).toBe(2);
  });
});

describe('GuildPlayer clearQueue', () => {
  it('refuses to clear an already empty queue', async () => {
    const { player, raw } = build();

    await expect(player.clearQueue()).rejects.toThrowError(QueueError);
    expect(raw.queue.splice).not.toHaveBeenCalled();
  });

  it('removes every pending track and reports the count', async () => {
    const { player, raw } = build();
    raw.queue.current = makeTrack('Playing');
    raw.queue.tracks.push(makeTrack('One'), makeTrack('Two'), makeTrack('Three'));

    const removed = await player.clearQueue();

    expect(removed).toBe(3);
    expect(raw.queue.splice).toHaveBeenCalledWith(0, 3);
  });

  it('leaves the current track playing', async () => {
    const { player, raw } = build();
    raw.queue.current = makeTrack('Playing');
    raw.queue.tracks.push(makeTrack('One'));

    await player.clearQueue();

    expect(raw.stopPlaying).not.toHaveBeenCalled();
    expect(raw.destroy).not.toHaveBeenCalled();
    expect(player.current?.info.title).toBe('Playing');
  });
});

describe('GuildPlayer queue paging', () => {
  it('reads the requested window from the queue', () => {
    const { player, raw } = build();
    raw.queue.tracks.push(...Array.from({ length: 25 }, (_, i) => makeTrack(`Track ${i}`)));

    player.pageOfQueue(2, 10);

    expect(raw.queue.getTracks).toHaveBeenCalledWith(20, 30);
  });
});
