import { z } from 'zod';

const boolish = z
  .string()
  .default('false')
  .transform((value) => ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase()));

const required = (name: string) => z.string().min(1, `${name} must not be empty`);

// SPOTIFY_* and YT_REFRESH_TOKEN are absent on purpose: they are consumed by the
// Lavalink container via application.yml substitution, never by this process.
const configSchema = z.object({
  DISCORD_TOKEN: required('DISCORD_TOKEN'),
  DISCORD_CLIENT_ID: required('DISCORD_CLIENT_ID'),
  DISCORD_DEV_GUILD_ID: z.string().optional(),

  LAVALINK_HOST: z.string().min(1).default('lavalink'),
  LAVALINK_PORT: z.coerce.number().int().min(1).max(65535).default(2333),
  LAVALINK_PASSWORD: required('LAVALINK_PASSWORD'),
  LAVALINK_SECURE: boolish,

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(180).default(5),
});

type RawConfig = z.infer<typeof configSchema>;

export interface DiscordConfig {
  readonly token: string;
  readonly clientId: string;
  readonly devGuildId: string | undefined;
}

export interface LavalinkConfig {
  readonly host: string;
  readonly port: number;
  readonly password: string;
  readonly secure: boolean;
}

export type LogLevel = RawConfig['LOG_LEVEL'];
export type Environment = RawConfig['NODE_ENV'];

/**
 * Validated application configuration.
 *
 * Construction fails fast: if anything is missing or malformed the process dies
 * at boot with every problem listed at once, rather than throwing later when
 * some command first touches the bad value.
 */
export class Config {
  public readonly discord: DiscordConfig;
  public readonly lavalink: LavalinkConfig;
  public readonly environment: Environment;
  public readonly logLevel: LogLevel;
  public readonly idleTimeoutMs: number;

  private constructor(raw: RawConfig) {
    this.discord = {
      token: raw.DISCORD_TOKEN,
      clientId: raw.DISCORD_CLIENT_ID,
      devGuildId: raw.DISCORD_DEV_GUILD_ID || undefined,
    };
    this.lavalink = {
      host: raw.LAVALINK_HOST,
      port: raw.LAVALINK_PORT,
      password: raw.LAVALINK_PASSWORD,
      secure: raw.LAVALINK_SECURE,
    };
    this.environment = raw.NODE_ENV;
    this.logLevel = raw.LOG_LEVEL;
    this.idleTimeoutMs = raw.IDLE_TIMEOUT_MINUTES * 60_000;
  }

  /** Parses and validates the environment, throwing with every problem listed. */
  public static load(env: NodeJS.ProcessEnv = process.env): Config {
    const result = configSchema.safeParse(env);

    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n');
      throw new Error(`Invalid configuration:\n${details}\n\nSee .env.example for the full list.`);
    }

    return new Config(result.data);
  }

  public get isProduction(): boolean {
    return this.environment === 'production';
  }

  public get isDevelopment(): boolean {
    return this.environment === 'development';
  }

  /**
   * Returns a log-safe view of the config, with secrets reduced to a presence
   * marker so startup logs can confirm a value was supplied without leaking it.
   */
  public toRedactedJSON(): Record<string, unknown> {
    return {
      environment: this.environment,
      logLevel: this.logLevel,
      idleTimeoutMs: this.idleTimeoutMs,
      discord: {
        clientId: this.discord.clientId,
        devGuildId: this.discord.devGuildId ?? null,
        token: Config.redact(this.discord.token),
      },
      lavalink: {
        host: this.lavalink.host,
        port: this.lavalink.port,
        secure: this.lavalink.secure,
        password: Config.redact(this.lavalink.password),
      },
    };
  }

  private static redact(value: string | undefined): string {
    return value ? '[set]' : '[unset]';
  }
}
