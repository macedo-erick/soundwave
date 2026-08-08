import { describe, expect, it } from 'vitest';
import { Format } from '../src/ui/Format.js';

describe('Format.duration', () => {
  it('formats under an hour as m:ss', () => {
    expect(Format.duration(187_000)).toBe('3:07');
  });

  it('formats an hour or more as h:mm:ss', () => {
    expect(Format.duration(3_753_000)).toBe('1:02:33');
  });

  it('labels live streams instead of showing a length', () => {
    expect(Format.duration(0, true)).toBe('🔴 LIVE');
  });

  it('falls back for unknown or negative durations', () => {
    expect(Format.duration(Number.NaN)).toBe('--:--');
    expect(Format.duration(-1)).toBe('--:--');
  });
});

describe('Format.longDuration', () => {
  it.each([
    [0, '0s'],
    [45_000, '45s'],
    [90_000, '1m 30s'],
    [8_043_000, '2h 14m 3s'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(Format.longDuration(ms)).toBe(expected);
  });
});

describe('Format.progressBar', () => {
  it('keeps a constant width regardless of position', () => {
    const widths = [0, 0.5, 1].map((ratio) => [...Format.progressBar(ratio * 1000, 1000)].length);

    expect(new Set(widths).size).toBe(1);
  });

  it('places the knob at the start and end at the extremes', () => {
    expect(Format.progressBar(0, 1000).startsWith('🔘')).toBe(true);
    expect(Format.progressBar(1000, 1000).endsWith('🔘')).toBe(true);
  });

  it('clamps a position beyond the track length', () => {
    expect(Format.progressBar(9999, 1000)).toBe(Format.progressBar(1000, 1000));
  });

  it('handles an unknown duration without dividing by zero', () => {
    expect(Format.progressBar(500, 0)).toContain('🔘');
  });
});

describe('Format.trackLink', () => {
  it('builds a masked link', () => {
    expect(Format.trackLink('Song', 'https://example.com')).toBe('[Song](https://example.com)');
  });

  it('escapes brackets that would break the markdown', () => {
    expect(Format.trackLink('Song [Remix]', 'https://example.com')).toBe(
      '[Song \\[Remix\\]](https://example.com)',
    );
  });

  it('falls back to plain text without a URI', () => {
    expect(Format.trackLink('Song', undefined)).toBe('Song');
  });

  it('truncates an overlong title', () => {
    expect(Format.trackLink('a'.repeat(100), undefined, 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

describe('Format.source', () => {
  it('maps known sources to display names', () => {
    expect(Format.source('youtube')).toBe('YouTube');
    expect(Format.source('spotify')).toBe('Spotify');
  });

  it('passes unknown sources through unchanged', () => {
    expect(Format.source('vimeo')).toBe('vimeo');
  });

  it('handles a missing source', () => {
    expect(Format.source(undefined)).toBe('Unknown');
  });
});
