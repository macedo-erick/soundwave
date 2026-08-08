import { describe, expect, it } from 'vitest';
import { Config } from '../src/config/Config.js';

const validEnv = {
  DISCORD_TOKEN: 'token-value',
  DISCORD_CLIENT_ID: '123456789',
  LAVALINK_PASSWORD: 'secret',
} satisfies NodeJS.ProcessEnv;

describe('Config', () => {
  it('applies defaults for everything optional', () => {
    const config = Config.load(validEnv);

    expect(config.lavalink.host).toBe('lavalink');
    expect(config.lavalink.port).toBe(2333);
    expect(config.lavalink.secure).toBe(false);
    expect(config.environment).toBe('development');
    expect(config.logLevel).toBe('info');
    expect(config.idleTimeoutMs).toBe(5 * 60_000);
  });

  it('reports every missing required variable at once', () => {
    expect(() => Config.load({})).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('DISCORD_TOKEN') as unknown as string,
      }),
    );

    try {
      Config.load({});
      expect.unreachable('expected a validation failure');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('DISCORD_TOKEN');
      expect(message).toContain('DISCORD_CLIENT_ID');
      expect(message).toContain('LAVALINK_PASSWORD');
    }
  });

  it('rejects a port outside the valid range', () => {
    expect(() => Config.load({ ...validEnv, LAVALINK_PORT: '70000' })).toThrowError(
      /LAVALINK_PORT/,
    );
  });

  it('rejects an unknown log level', () => {
    expect(() => Config.load({ ...validEnv, LOG_LEVEL: 'chatty' })).toThrowError(/LOG_LEVEL/);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['YES', true],
    ['on', true],
    ['false', false],
    ['0', false],
    ['', false],
  ])('coerces LAVALINK_SECURE=%s to %s', (raw, expected) => {
    expect(Config.load({ ...validEnv, LAVALINK_SECURE: raw }).lavalink.secure).toBe(expected);
  });

  it('converts the idle timeout from minutes to milliseconds', () => {
    expect(Config.load({ ...validEnv, IDLE_TIMEOUT_MINUTES: '15' }).idleTimeoutMs).toBe(900_000);
  });

  it('treats an empty dev guild ID as unset', () => {
    expect(
      Config.load({ ...validEnv, DISCORD_DEV_GUILD_ID: '' }).discord.devGuildId,
    ).toBeUndefined();
  });

  it('never exposes secrets in the redacted view', () => {
    const redacted = JSON.stringify(Config.load(validEnv).toRedactedJSON());

    expect(redacted).not.toContain('token-value');
    expect(redacted).not.toContain('secret');
    expect(redacted).toContain('[set]');
  });

  it('marks production correctly', () => {
    const production = Config.load({ ...validEnv, NODE_ENV: 'production' });

    expect(production.isProduction).toBe(true);
    expect(production.isDevelopment).toBe(false);
  });
});
