/**
 * Base for every error this application raises deliberately.
 *
 * The split that matters is {@link UserFacingError} vs {@link SystemError}: the
 * first is an expected outcome of user input and is shown verbatim in Discord,
 * the second is a defect or an outage and gets a generic reply plus a full
 * stack in the logs. `ErrorHandler` is the only place that decides.
 */
export abstract class AppError extends Error {
  public abstract readonly isUserFacing: boolean;
  public abstract readonly code: string;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

/**
 * The user did something the bot can't act on — wrong channel, bad URL, empty
 * queue. The message is written for the person who typed the command, so it
 * must stay free of internal detail.
 */
export class UserFacingError extends AppError {
  public readonly isUserFacing = true;

  constructor(
    message: string,
    public readonly code: string = 'USER_ERROR',
    public readonly hint?: string,
  ) {
    super(message);
  }
}

/** Caller is not in a voice channel, or not in the same one as the bot. */
export class VoiceChannelError extends UserFacingError {
  constructor(message: string, hint?: string) {
    super(message, 'VOICE_CHANNEL', hint);
  }
}

/** A search or URL produced no playable track. */
export class TrackResolutionError extends UserFacingError {
  constructor(message: string, hint?: string) {
    super(message, 'TRACK_RESOLUTION', hint);
  }
}

/** A queue operation was requested with nothing playing or nothing queued. */
export class QueueError extends UserFacingError {
  constructor(message: string, hint?: string) {
    super(message, 'QUEUE', hint);
  }
}

/**
 * Something broke that the user cannot fix: Lavalink unreachable, Discord API
 * failure, a bug. Never surfaced verbatim.
 */
export class SystemError extends AppError {
  public readonly isUserFacing = false;

  constructor(
    message: string,
    public readonly code: string = 'SYSTEM_ERROR',
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** The Lavalink audio node is down or unreachable. */
export class AudioNodeError extends SystemError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'AUDIO_NODE', options);
  }
}
