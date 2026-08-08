import type { Player, Track } from 'lavalink-client';
import { QueueError } from '../errors/AppError.js';
import type { Logger } from '../logging/Logger.js';
import type { TrackResolver } from './TrackResolver.js';
import type { AnyTrack, ResolvedQuery } from './types.js';

export interface EnqueueResult {
  readonly resolution: ResolvedQuery;
  readonly startedImmediately: boolean;
  readonly positionInQueue: number;
}

/**
 * Facade over one guild's Lavalink player and queue.
 *
 * Commands talk to this and never to `lavalink-client` directly, so the guards
 * ("nothing is playing", "queue is empty") are enforced in one place and the
 * client library stays swappable.
 */
export class GuildPlayer {
  constructor(
    private readonly player: Player,
    private readonly resolver: TrackResolver,
    private readonly logger: Logger,
  ) {}

  public get guildId(): string {
    return this.player.guildId;
  }

  public get voiceChannelId(): string | null {
    return this.player.voiceChannelId;
  }

  public get current(): Track | null {
    return this.player.queue.current;
  }

  public get upcoming(): AnyTrack[] {
    return this.player.queue.tracks;
  }

  public get queueLength(): number {
    return this.player.queue.tracks.length;
  }

  public get isPlaying(): boolean {
    return this.player.playing;
  }

  public get isPaused(): boolean {
    return this.player.paused;
  }

  public get position(): number {
    return this.player.position;
  }

  public get volume(): number {
    return this.player.volume;
  }

  public get connected(): boolean {
    return this.player.connected === true;
  }

  /** Joins the voice channel if not already connected. */
  public async connect(): Promise<void> {
    if (!this.connected) {
      await this.player.connect();
    }
  }

  /**
   * Resolves a query, appends the result to the queue, and starts playback if
   * the player was idle.
   */
  public async enqueue(query: string, requester: unknown): Promise<EnqueueResult> {
    const resolution = await this.resolver.resolve(this.player, query, requester);
    const positionInQueue = this.queueLength + 1;

    await this.player.queue.add(resolution.tracks);

    const shouldStart = !this.player.playing && !this.player.paused;
    if (shouldStart) {
      await this.player.play();
    }

    this.logger.debug('Enqueued tracks', {
      kind: resolution.kind,
      count: resolution.tracks.length,
      startedImmediately: shouldStart,
    });

    return { resolution, startedImmediately: shouldStart, positionInQueue };
  }

  /**
   * Skips the current track, returning the track that was skipped.
   *
   * `Player#skip` throws when the queue is empty, so the last track is stopped
   * deliberately instead and the idle timeout handles the disconnect.
   */
  public async skip(): Promise<Track> {
    const skipped = this.current;
    if (!skipped) {
      throw new QueueError('Nothing is playing right now.');
    }

    if (this.queueLength === 0) {
      await this.player.stopPlaying(false, false);
      return skipped;
    }

    await this.player.skip();
    return skipped;
  }

  public async pause(): Promise<Track> {
    const track = this.requireCurrent();
    if (this.isPaused) {
      throw new QueueError('Playback is already paused.', 'Use `/resume` to continue.');
    }
    await this.player.pause();
    return track;
  }

  public async resume(): Promise<Track> {
    const track = this.requireCurrent();
    if (!this.isPaused) {
      throw new QueueError('Playback is not paused.');
    }
    await this.player.resume();
    return track;
  }

  /** Clears the queue, stops playback, and leaves the voice channel. */
  public async stop(): Promise<void> {
    await this.player.destroy('Stopped by user command', true);
  }

  /**
   * Removes every pending track while the current one keeps playing. This is
   * the difference from `stop`, which also disconnects.
   */
  public async clearQueue(): Promise<number> {
    const removed = this.queueLength;
    if (removed === 0) {
      throw new QueueError('The queue is already empty.', 'Queue something with `/play`.');
    }
    await this.player.queue.splice(0, removed);
    return removed;
  }

  /** Shuffles the pending queue, leaving the current track untouched. */
  public async shuffle(): Promise<number> {
    if (this.queueLength < 2) {
      throw new QueueError(
        'There are not enough queued tracks to shuffle.',
        'Queue at least two tracks first.',
      );
    }
    await this.player.queue.shuffle();
    return this.queueLength;
  }

  public totalQueueDuration(): number {
    return this.player.queue.utils.totalDuration();
  }

  public pageOfQueue(page: number, pageSize: number): AnyTrack[] {
    const start = page * pageSize;
    return this.player.queue.getTracks(start, start + pageSize);
  }

  public requireCurrent(): Track {
    const track = this.current;
    if (!track) {
      throw new QueueError('Nothing is playing right now.', 'Start something with `/play`.');
    }
    return track;
  }
}
