import type { ClientEvents } from 'discord.js';
import { EventHandler } from '../core/EventRegistry.js';
import type { Logger } from '../logging/Logger.js';
import type { GuildPlayerManager } from '../music/GuildPlayerManager.js';

/**
 * Disconnects the bot when it is left alone in a voice channel.
 *
 * Without this the bot holds a voice connection indefinitely after everyone
 * leaves. The queue-empty case is handled separately by Lavalink's idle timeout.
 */
export class VoiceStateUpdateEvent extends EventHandler<'voiceStateUpdate'> {
  private readonly pendingDisconnects = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly players: GuildPlayerManager,
    private readonly logger: Logger,
    private readonly graceMs: number,
  ) {
    super();
  }

  public readonly event = 'voiceStateUpdate' as const;

  public handle(...args: ClientEvents['voiceStateUpdate']): void {
    const [oldState, newState] = args;
    const guildId = newState.guild.id;
    const player = this.players.get(guildId);

    if (!player?.voiceChannelId) {
      this.cancelPending(guildId);
      return;
    }

    const channel = newState.guild.channels.cache.get(player.voiceChannelId);
    if (!channel?.isVoiceBased()) return;

    const affectsOurChannel =
      oldState.channelId === player.voiceChannelId || newState.channelId === player.voiceChannelId;
    if (!affectsOurChannel) return;

    const listeners = channel.members.filter((member) => !member.user.bot).size;

    if (listeners > 0) {
      this.cancelPending(guildId);
      return;
    }

    this.scheduleDisconnect(guildId);
  }

  private scheduleDisconnect(guildId: string): void {
    if (this.pendingDisconnects.has(guildId)) return;

    const timer = setTimeout(() => {
      this.pendingDisconnects.delete(guildId);
      void this.disconnectIfStillAlone(guildId);
    }, this.graceMs);

    timer.unref();
    this.pendingDisconnects.set(guildId, timer);
  }

  private async disconnectIfStillAlone(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (!player) return;

    try {
      await player.stop();
      this.logger.info('Left an empty voice channel', { guildId });
    } catch (error) {
      this.logger.warn('Failed to leave an empty voice channel', {
        guildId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private cancelPending(guildId: string): void {
    const timer = this.pendingDisconnects.get(guildId);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingDisconnects.delete(guildId);
  }
}
