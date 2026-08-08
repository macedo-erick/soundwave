import type { Client } from 'discord.js';
import {
  LavalinkManager,
  type SearchPlatform,
  type VoicePacket,
  type VoiceServer,
  type VoiceState,
} from 'lavalink-client';
import type { Config } from '../config/Config.js';
import { AudioNodeError } from '../errors/AppError.js';
import type { Logger } from '../logging/Logger.js';
import type { Requester } from './types.js';

export const DEFAULT_SEARCH_PLATFORM: SearchPlatform = 'ytmsearch';

/**
 * Owns the connection to the Lavalink audio node.
 *
 * The bot process never handles audio itself. Lavalink extracts and streams
 * everything, which keeps YouTube's datacenter-IP bot challenge out of this
 * codebase — the countermeasures (client rotation, OAuth, poToken) live in the
 * node's youtube-source plugin, not here.
 */
export class LavalinkService {
  private readonly manager: LavalinkManager;
  private ready = false;

  constructor(
    private readonly client: Client,
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    this.manager = new LavalinkManager({
      nodes: [
        {
          id: 'main',
          host: config.lavalink.host,
          port: config.lavalink.port,
          authorization: config.lavalink.password,
          secure: config.lavalink.secure,
          // Lavalink and the bot start together under compose and the bot
          // usually wins the race, so retry patiently instead of dying at boot.
          retryAmount: 10,
          retryDelay: 5_000,
          closeOnError: true,
          heartBeatInterval: 30_000,
          enablePingOnStatsCheck: true,
        },
      ],
      sendToShard: (guildId, payload) => {
        this.client.guilds.cache.get(guildId)?.shard.send(payload);
      },
      autoSkip: true,
      autoSkipOnResolveError: true,
      emitNewSongsOnly: true,
      playerOptions: {
        defaultSearchPlatform: DEFAULT_SEARCH_PLATFORM,
        volumeDecrementer: 0.75,
        onDisconnect: { autoReconnect: true, destroyPlayer: false },
        onEmptyQueue: { destroyAfterMs: config.idleTimeoutMs },
        requesterTransformer: (requester): Requester => {
          const user = requester as Partial<Requester> & {
            displayAvatarURL?: (options?: unknown) => string;
            tag?: string;
            globalName?: string | null;
          };
          return {
            id: user.id ?? 'unknown',
            username: user.username ?? user.tag ?? 'Unknown',
            displayName: user.displayName ?? user.globalName ?? user.username ?? 'Unknown',
            avatarUrl:
              typeof user.displayAvatarURL === 'function'
                ? user.displayAvatarURL({ size: 128 })
                : (user.avatarUrl ?? null),
          };
        },
      },
      queueOptions: { maxPreviousTracks: 25 },
    });

    this.registerNodeEvents();
  }

  public get lavalink(): LavalinkManager {
    return this.manager;
  }

  public get isReady(): boolean {
    return this.ready && this.manager.useable;
  }

  /**
   * Forwards raw gateway payloads to Lavalink. Voice state and server updates
   * arrive on the raw event; without this the node can never open a voice
   * connection.
   */
  public attachRawForwarder(): void {
    this.client.on('raw', (payload: VoicePacket | VoiceServer | VoiceState) => {
      void this.manager.sendRawData(payload);
    });
  }

  /** Initialises the manager once the Discord client's user ID is known. */
  public async init(userId: string, username: string): Promise<void> {
    await this.manager.init({ id: userId, username });
    this.ready = true;
    this.logger.info('Lavalink manager initialised', {
      host: this.config.lavalink.host,
      port: this.config.lavalink.port,
    });
  }

  /** Throws if no node can serve a request, so commands fail with a clear cause. */
  public assertReady(): void {
    if (!this.isReady) {
      throw new AudioNodeError('No Lavalink node is connected');
    }
  }

  public destroy(): void {
    for (const node of this.manager.nodeManager.nodes.values()) {
      try {
        node.destroy();
      } catch (error) {
        this.logger.warn('Failed to close a Lavalink node cleanly', {
          nodeId: node.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.ready = false;
  }

  private registerNodeEvents(): void {
    const nodes = this.manager.nodeManager;

    nodes.on('connect', (node) => {
      this.logger.info('Lavalink node connected', { nodeId: node.id });
    });

    nodes.on('reconnecting', (node) => {
      this.logger.warn('Lavalink node reconnecting', { nodeId: node.id });
    });

    nodes.on('disconnect', (node, reason) => {
      this.logger.warn('Lavalink node disconnected', {
        nodeId: node.id,
        code: reason.code,
        reason: reason.reason,
      });
    });

    nodes.on('error', (node, error, payload) => {
      this.logger.error('Lavalink node error', error, { nodeId: node.id, payload });
    });

    nodes.on('destroy', (node, reason) => {
      this.logger.warn('Lavalink node destroyed', { nodeId: node.id, reason });
    });
  }
}
