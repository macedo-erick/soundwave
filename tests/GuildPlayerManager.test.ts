import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type { Client } from 'discord.js';
import type { Player } from 'lavalink-client';
import { GuildPlayerManager } from '../src/music/GuildPlayerManager.js';
import { VoiceChannelError } from '../src/errors/AppError.js';
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

function build() {
  const players = new Map<string, Player>();
  const createPlayer = vi.fn((options: { guildId: string; voiceChannelId: string }) => {
    const player = makeRawPlayer(options.guildId, options.voiceChannelId);
    players.set(options.guildId, player);
    return player;
  });

  const lavalinkService = {
    lavalink: {
      getPlayer: (guildId: string) => players.get(guildId),
      createPlayer,
    },
    assertReady: vi.fn(),
  } as unknown as LavalinkService;

  const manager = new GuildPlayerManager(
    {} as Client,
    lavalinkService,
    {} as TrackResolver,
    silentLogger,
  );

  return { manager, players, createPlayer };
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
