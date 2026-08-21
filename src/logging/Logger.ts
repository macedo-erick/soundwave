import { createRequire } from 'node:module';
import { pino, type Logger as PinoLogger } from 'pino';
import type { Config, LogLevel } from '../config/Config.js';

export interface LogContext {
  readonly guildId?: string | undefined;
  readonly commandName?: string | undefined;
  readonly interactionId?: string | undefined;
  readonly userId?: string | undefined;
  readonly [key: string]: unknown;
}

/**
 * Thin wrapper over pino.
 *
 * Everything goes to stdout — no files, no rotation. In a container the runtime
 * collects stdout, so writing logs to disk only creates volumes nobody reads.
 * Development gets human-readable output; production emits JSON for indexing.
 */
export class Logger {
  private constructor(private readonly pinoLogger: PinoLogger) {}

  public static create(config: Config): Logger {
    return new Logger(
      pino({
        level: config.logLevel,
        base: { service: 'soundwave', env: config.environment },
        redact: {
          paths: ['token', '*.token', 'password', '*.password', 'authorization', '*.headers'],
          censor: '[redacted]',
        },
        ...(config.isProduction || !Logger.canPrettyPrint()
          ? {}
          : {
              transport: {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  translateTime: 'HH:MM:ss.l',
                  ignore: 'pid,hostname,service,env',
                },
              },
            }),
      }),
    );
  }

  /**
   * Whether `pino-pretty` can be loaded from this install.
   *
   * It is a devDependency, so the production image built by `deps` does not
   * carry it. Naming it as a transport target there kills the process at
   * startup, which is what happens whenever that image runs with
   * NODE_ENV=development — a combination worth supporting, since the same flag
   * scopes command registration to the dev guild. Pretty output is a nicety;
   * degrade to JSON rather than refuse to boot.
   */
  private static canPrettyPrint(): boolean {
    try {
      createRequire(import.meta.url).resolve('pino-pretty');
      return true;
    } catch {
      return false;
    }
  }

  /** Test seam: wraps a caller-supplied pino instance. */
  public static fromPino(instance: PinoLogger): Logger {
    return new Logger(instance);
  }

  /**
   * Derives a logger that stamps `context` onto every record, so one request is
   * greppable from dispatch through to playback.
   */
  public child(context: LogContext): Logger {
    return new Logger(this.pinoLogger.child(context));
  }

  public trace(message: string, data?: object): void {
    this.pinoLogger.trace(data ?? {}, message);
  }

  public debug(message: string, data?: object): void {
    this.pinoLogger.debug(data ?? {}, message);
  }

  public info(message: string, data?: object): void {
    this.pinoLogger.info(data ?? {}, message);
  }

  public warn(message: string, data?: object): void {
    this.pinoLogger.warn(data ?? {}, message);
  }

  public error(message: string, error?: unknown, data?: object): void {
    this.pinoLogger.error({ ...data, err: Logger.serializeError(error) }, message);
  }

  public fatal(message: string, error?: unknown, data?: object): void {
    this.pinoLogger.fatal({ ...data, err: Logger.serializeError(error) }, message);
  }

  public get level(): LogLevel {
    return this.pinoLogger.level as LogLevel;
  }

  /** Normalises anything thrown — `catch` binds `unknown` — into a loggable shape. */
  private static serializeError(error: unknown): object | undefined {
    if (error === undefined) return undefined;
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error.cause ? { cause: Logger.serializeError(error.cause) } : {}),
      };
    }
    return { name: 'NonError', message: Logger.stringify(error) };
  }

  private static stringify(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
      try {
        return JSON.stringify(value) ?? '[unserialisable]';
      } catch {
        return '[unserialisable]';
      }
    }
    return String(value);
  }
}
