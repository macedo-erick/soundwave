import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type { Client } from 'discord.js';
import type { Player } from 'lavalink-client';
import { GuildPlayerManager } from '../src/music/GuildPlayerManager.js';
import { AudioNodeError, TrackResolutionError, VoiceChannelError } from '../src/errors/AppError.js';
import { Logger } from '../src/logging/Logger.js';
import type { LavalinkService } from '../src/music/LavalinkService.js';
import type { TrackResolver } from '../src/music/TrackResolver.js';

const silentLogger = Logger.fromPino(pino({ level: 'silent' }));

function makeRawPlayer(guildId: string, voiceChannelId = 'voice-1') {
  return {
    guildId,
    voiceChannelId,
    connected: true,
    playing: false,
    paused: false,
    position: 0,
    volume: 100,
    queue: { current: null, tracks: [], utils: { totalDuration: () => 0 } },
    connect: vi.fn().mockResolvedValue(undefined),
  } as unknown as Player;
}

function build(options: { nodeConnected?: boolean; resolveImpl?: () => Promise<unknown> } = {}) {
  const players = new Map<string, Player>();
  const createPlayer = vi.fn((opts: { guildId: string; voiceChannelId: string }) => {
    const player = makeRawPlayer(opts.guildId, opts.voiceChannelId);
    players.set(opts.guildId, player);
    return player;
  });

  const node = { id: 'main', connected: options.nodeConnected ?? true };
  const lavalinkService = {
    lavalink: {
      getPlayer: (guildId: string) => players.get(guildId),
      createPlayer,
      nodeManager: { nodes: new Map([['main', node]]) },
    },
    assertReady: vi.fn(),
  } as unknown as LavalinkService;

  const resolve = vi.fn(
    options.resolveImpl ??
      (() => Promise.resolve({ kind: 'track', tracks: [{ info: { title: 'Song' } }] })),
  );
  const resolver = { resolve } as unknown as TrackResolver;

  const manager = new GuildPlayerManager({} as Client, lavalinkService, resolver, silentLogger);

  return { manager, players, createPlayer, resolve };
}

function makeMember(options: {
  guildId: string;
  channelId: string | null;
  canConnect?: boolean;
  channelName?: string;
}) {
  const permissions = {
    has: (permission: string) =>
      options.canConnect !== false && ['Connect', 'Speak'].includes(permission),
  };

  return {
    guild: {
      id: options.guildId,
      members: { me: {} },
      channels: { cache: new Map() },
    },
    client: { user: { id: 'bot' } },
    voice: {
      channel: options.channelId
        ? {
            id: options.channelId,
            name: options.channelName ?? 'General',
            permissionsFor: () => permissions,
          }
        : null,
    },
  } as never;
}

describe('GuildPlayerManager guild isolation', () => {
  it('keeps separate players per guild', async () => {
    const { manager } = build();

    const first = await manager.getOrCreate({
      guildId: 'guild-a',
      voiceChannelId: 'voice-a',
      textChannelId: 'text-a',
    });
    const second = await manager.getOrCreate({
      guildId: 'guild-b',
      voiceChannelId: 'voice-b',
      textChannelId: 'text-b',
    });

    expect(first.guildId).toBe('guild-a');
    expect(second.guildId).toBe('guild-b');
    expect(first.voiceChannelId).not.toBe(second.voiceChannelId);
  });

  it('reuses the existing player for a guild instead of creating a second', async () => {
    const { manager, createPlayer } = build();

    await manager.getOrCreate({
      guildId: 'guild-a',
      voiceChannelId: 'voice-a',
      textChannelId: 'text-a',
    });
    await manager.getOrCreate({
      guildId: 'guild-a',
      voiceChannelId: 'voice-a',
      textChannelId: 'text-a',
    });

    expect(createPlayer).toHaveBeenCalledOnce();
  });

  it('returns null for a guild with no player', () => {
    const { manager } = build();

    expect(manager.get('guild-unknown')).toBeNull();
  });

  it('throws a user-facing error when requiring a missing player', () => {
    const { manager } = build();

    expect(() => manager.require('guild-unknown')).toThrowError(VoiceChannelError);
  });
});

describe('GuildPlayerManager.resolve', () => {
  // Regression: /play used to join the voice channel before resolving, so a
  // dead link left the bot connected to an empty queue with no idle timer
  // armed — it sat there silently until someone ran /stop.
  it('never creates a player when resolution fails', async () => {
    const { manager, createPlayer } = build({
      resolveImpl: () => Promise.reject(new TrackResolutionError('No results.')),
    });

    await expect(manager.resolve('a dead spotify link', { id: 'u1' })).rejects.toThrowError(
      TrackResolutionError,
    );
    expect(createPlayer).not.toHaveBeenCalled();
    expect(manager.get('guild-a')).toBeNull();
  });

  it('resolves against a connected node without touching voice', async () => {
    const { manager, createPlayer, resolve } = build();

    const result = await manager.resolve('a song', { id: 'u1' });

    expect(result.tracks).toHaveLength(1);
    expect(resolve).toHaveBeenCalledOnce();
    expect(createPlayer).not.toHaveBeenCalled();
  });

  it('fails clearly when no node is connected', async () => {
    const { manager } = build({ nodeConnected: false });

    await expect(manager.resolve('a song', { id: 'u1' })).rejects.toThrowError(AudioNodeError);
  });
});

describe('GuildPlayerManager.assertCanControl', () => {
  it('rejects a member outside a voice channel', () => {
    const { manager } = build();

    expect(() =>
      manager.assertCanControl(makeMember({ guildId: 'guild-a', channelId: null })),
    ).toThrowError(VoiceChannelError);
  });

  it('rejects a member in a different channel than the active player', async () => {
    const { manager } = build();
    await manager.getOrCreate({
      guildId: 'guild-a',
      voiceChannelId: 'voice-a',
      textChannelId: 'text-a',
    });

    expect(() =>
      manager.assertCanControl(makeMember({ guildId: 'guild-a', channelId: 'voice-other' })),
    ).toThrowError(/already playing in another voice channel/);
  });

  it('rejects a channel the bot cannot join', () => {
    const { manager } = build();

    expect(() =>
      manager.assertCanControl(
        makeMember({ guildId: 'guild-a', channelId: 'voice-a', canConnect: false }),
      ),
    ).toThrowError(/permission/);
  });

  it('accepts a member in the same channel as the active player', async () => {
    const { manager } = build();
    await manager.getOrCreate({
      guildId: 'guild-a',
      voiceChannelId: 'voice-a',
      textChannelId: 'text-a',
    });

    const channel = manager.assertCanControl(
      makeMember({ guildId: 'guild-a', channelId: 'voice-a' }),
    );

    expect(channel.id).toBe('voice-a');
  });
});
