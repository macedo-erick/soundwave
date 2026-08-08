import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type { RepliableInteraction } from 'discord.js';
import { ErrorHandler } from '../src/errors/ErrorHandler.js';
import {
  AudioNodeError,
  QueueError,
  SystemError,
  UserFacingError,
  VoiceChannelError,
} from '../src/errors/AppError.js';
import { Logger } from '../src/logging/Logger.js';
import { EmbedFactory } from '../src/ui/EmbedFactory.js';

const silentLogger = Logger.fromPino(pino({ level: 'silent' }));

function makeInteraction(state: { deferred?: boolean; replied?: boolean } = {}) {
  return {
    id: 'interaction-1',
    guildId: 'guild-1',
    user: { id: 'user-1' },
    deferred: state.deferred ?? false,
    replied: state.replied ?? false,
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as RepliableInteraction & {
    reply: ReturnType<typeof vi.fn>;
    editReply: ReturnType<typeof vi.fn>;
    followUp: ReturnType<typeof vi.fn>;
  };
}

describe('ErrorHandler.normalize', () => {
  it('passes AppError subclasses through unchanged', () => {
    const original = new QueueError('empty');

    expect(ErrorHandler.normalize(original)).toBe(original);
  });

  it('wraps a plain Error as a non-user-facing SystemError', () => {
    const normalized = ErrorHandler.normalize(new Error('boom'));

    expect(normalized).toBeInstanceOf(SystemError);
    expect(normalized.isUserFacing).toBe(false);
    expect(normalized.code).toBe('UNHANDLED');
  });

  it('wraps a thrown non-Error value', () => {
    const normalized = ErrorHandler.normalize('just a string');

    expect(normalized).toBeInstanceOf(SystemError);
    expect(normalized.message).toBe('just a string');
  });
});

describe('AppError classification', () => {
  it.each([
    [new UserFacingError('nope'), true, 'USER_ERROR'],
    [new VoiceChannelError('join first'), true, 'VOICE_CHANNEL'],
    [new QueueError('empty'), true, 'QUEUE'],
    [new SystemError('broken'), false, 'SYSTEM_ERROR'],
    [new AudioNodeError('node down'), false, 'AUDIO_NODE'],
  ])('classifies %s', (error, isUserFacing, code) => {
    expect(error.isUserFacing).toBe(isUserFacing);
    expect(error.code).toBe(code);
  });
});

describe('ErrorHandler reply routing', () => {
  it('replies directly when the interaction is untouched', async () => {
    const interaction = makeInteraction();

    await new ErrorHandler(silentLogger).handleInteractionError(
      new QueueError('Nothing is playing.'),
      interaction,
    );

    expect(interaction.reply).toHaveBeenCalledOnce();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('edits the reply when the interaction was deferred', async () => {
    const interaction = makeInteraction({ deferred: true });

    await new ErrorHandler(silentLogger).handleInteractionError(
      new QueueError('Nothing is playing.'),
      interaction,
    );

    expect(interaction.editReply).toHaveBeenCalledOnce();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('follows up when the interaction was already replied to', async () => {
    const interaction = makeInteraction({ replied: true });

    await new ErrorHandler(silentLogger).handleInteractionError(
      new QueueError('Nothing is playing.'),
      interaction,
    );

    expect(interaction.followUp).toHaveBeenCalledOnce();
  });

  it('never rejects when Discord refuses the error reply', async () => {
    const interaction = makeInteraction();
    interaction.reply.mockRejectedValue(new Error('Unknown interaction'));

    await expect(
      new ErrorHandler(silentLogger).handleInteractionError(new Error('original'), interaction),
    ).resolves.toBeUndefined();
  });
});

describe('EmbedFactory.error', () => {
  it('shows a user-facing message verbatim', () => {
    const embed = EmbedFactory.error(new QueueError('The queue is empty.'));

    expect(embed.data.description).toContain('The queue is empty.');
  });

  it('hides internal detail behind a generic message', () => {
    const embed = EmbedFactory.error(new SystemError('Lavalink connection refused at 10.0.0.5'));

    expect(embed.data.description).not.toContain('10.0.0.5');
    expect(embed.data.description).toContain('Something went wrong');
  });

  it('surfaces the hint as a footer', () => {
    const embed = EmbedFactory.error(new VoiceChannelError('Join a channel.', 'Then try again.'));

    expect(embed.data.footer?.text).toBe('Then try again.');
  });
});
