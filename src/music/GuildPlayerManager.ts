import { ChannelType, type Client, type GuildMember, type VoiceBasedChannel } from 'discord.js';
import { VoiceChannelError } from '../errors/AppError.js';
import type { Logger } from '../logging/Logger.js';
import { EmbedFactory } from '../ui/EmbedFactory.js';
import { GuildPlayer } from './GuildPlayer.js';
import type { LavalinkService } from './LavalinkService.js';
import type { TrackResolver } from './TrackResolver.js';

export interface CreatePlayerOptions {
  readonly guildId: string;
  readonly voiceChannelId: string;
  readonly textChannelId: string;
}

/**
 * Owns the set of per-guild players.
 *
 * Guild isolation is the point: every lookup is keyed by guild ID, so a command
 * in one server can never reach another server's queue. Players are wrapped on
 * demand rather than cached, which avoids stale references after a player is
 * destroyed by the idle timeout.
 */
export class GuildPlayerManager {
  constructor(
    private readonly client: Client,
    private readonly lavalinkService: LavalinkService,
    private readonly resolver: TrackResolver,
    private readonly logger: Logger,
  ) {}

  /** Returns the guild's player, or null when the bot is not active there. */
  public get(guildId: string): GuildPlayer | null {
    const player = this.lavalinkService.lavalink.getPlayer(guildId);
    return player ? new GuildPlayer(player, this.resolver, this.logger) : null;
  }

  /**
   * Returns the guild's player, throwing a user-facing error when the bot is
   * not currently playing there.
   */
  public require(guildId: string): GuildPlayer {
    const player = this.get(guildId);
    if (!player) {
      throw new VoiceChannelError(
        "I'm not playing anything in this server.",
        'Start something with `/play`.',
      );
    }
    return player;
  }

  /** Returns the guild's player, creating and connecting one if needed. */
  public async getOrCreate(options: CreatePlayerOptions): Promise<GuildPlayer> {
    this.lavalinkService.assertReady();

    const existing = this.get(options.guildId);
    if (existing) {
      await existing.connect();
      return existing;
    }

    const player = this.lavalinkService.lavalink.createPlayer({
      guildId: options.guildId,
      voiceChannelId: options.voiceChannelId,
      textChannelId: options.textChannelId,
      selfDeaf: true,
      selfMute: false,
      volume: 100,
    });

    const guildPlayer = new GuildPlayer(player, this.resolver, this.logger);
    await guildPlayer.connect();

    this.logger.info('Created a player', {
      guildId: options.guildId,
      voiceChannelId: options.voiceChannelId,
    });
    return guildPlayer;
  }

  /**
   * Validates that the caller may control playback in this guild, returning the
   * voice channel they are in.
   *
   * Rejects members outside a voice channel, channels the bot cannot join, and
   * attempts to hijack playback from a different channel.
   */
  public assertCanControl(member: GuildMember): VoiceBasedChannel {
    const channel = member.voice.channel;
    if (!channel) {
      throw new VoiceChannelError(
        'You need to be in a voice channel first.',
        'Join one, then run the command again.',
      );
    }

    const active = this.get(member.guild.id);
    if (active?.connected && active.voiceChannelId && active.voiceChannelId !== channel.id) {
      throw new VoiceChannelError(
        "I'm already playing in another voice channel.",
        'Join that channel to control playback.',
      );
    }

    const permissions = channel.permissionsFor(member.guild.members.me ?? member.client.user.id);
    if (!permissions?.has('Connect') || !permissions.has('Speak')) {
      throw new VoiceChannelError(
        `I don't have permission to join and speak in **${channel.name}**.`,
        'Grant me the Connect and Speak permissions there.',
      );
    }

    return channel;
  }

  /**
   * Subscribes to Lavalink player events for announcements and logging.
   *
   * Called once at startup. Announcements are best-effort: a missing or
   * forbidden text channel must never break playback.
   */
  public registerPlayerEvents(): void {
    const manager = this.lavalinkService.lavalink;

    manager.on('trackStart', (player, track) => {
      const logger = this.logger.child({ guildId: player.guildId });
      logger.info('Track started', {
        title: track?.info.title,
        source: track?.info.sourceName,
      });

      if (!track) return;
      void this.announce(player.guildId, player.textChannelId, () =>
        EmbedFactory.nowPlaying({
          track,
          position: 0,
          paused: false,
          volume: player.volume,
          queueLength: player.queue.tracks.length,
        }),
      );
    });

    manager.on('trackError', (player, track, payload) => {
      this.logger
        .child({ guildId: player.guildId })
        .error('Track failed to play', payload.exception, {
          title: track?.info.title,
        });

      void this.announce(player.guildId, player.textChannelId, () =>
        EmbedFactory.warning(
          `Skipping **${track?.info.title ?? 'a track'}** — it could not be played.`,
        ),
      );
    });

    manager.on('trackStuck', (player, track) => {
      this.logger.child({ guildId: player.guildId }).warn('Track stuck, skipping', {
        title: track?.info.title,
      });
    });

    manager.on('queueEnd', (player) => {
      this.logger.child({ guildId: player.guildId }).info('Queue finished');

      void this.announce(player.guildId, player.textChannelId, () =>
        EmbedFactory.info("That's the end of the queue. I'll leave if nothing else is queued."),
      );
    });

    manager.on('playerDestroy', (player, reason) => {
      this.logger.child({ guildId: player.guildId }).info('Player destroyed', { reason });
    });

    manager.on('playerDisconnect', (player) => {
      this.logger.child({ guildId: player.guildId }).info('Player disconnected from voice');
    });
  }

  private async announce(
    guildId: string,
    textChannelId: string | null,
    build: () => ReturnType<typeof EmbedFactory.info>,
  ): Promise<void> {
    if (!textChannelId) return;

    try {
      const channel = await this.client.channels.fetch(textChannelId);
      if (!channel || channel.type !== ChannelType.GuildText) return;
      await channel.send({ embeds: [build()] });
    } catch (error) {
      this.logger.debug('Could not post an announcement', {
        guildId,
        textChannelId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
