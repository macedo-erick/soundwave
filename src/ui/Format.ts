/** Presentation helpers shared by the embed builders. */
export class Format {
  private static readonly PROGRESS_WIDTH = 20;

  /** Formats a millisecond duration as `3:07`, or `1:02:33` past an hour. */
  public static duration(ms: number, isStream = false): string {
    if (isStream) return '🔴 LIVE';
    if (!Number.isFinite(ms) || ms < 0) return '--:--';

    const totalSeconds = Math.floor(ms / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);

    const pad = (n: number) => n.toString().padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  }

  /** Formats a duration as `2h 14m 3s`, used for queue totals. */
  public static longDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0s';

    const totalSeconds = Math.floor(ms / 1000);
    const parts: string[] = [];
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const seconds = totalSeconds % 60;

    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
    return parts.join(' ');
  }

  /** Renders a text progress bar, since embeds have no native one. */
  public static progressBar(position: number, duration: number): string {
    if (!Number.isFinite(duration) || duration <= 0) {
      return '🔘' + '▬'.repeat(Format.PROGRESS_WIDTH - 1);
    }

    const ratio = Math.min(Math.max(position / duration, 0), 1);
    const knob = Math.min(
      Math.round(ratio * (Format.PROGRESS_WIDTH - 1)),
      Format.PROGRESS_WIDTH - 1,
    );
    return '▬'.repeat(knob) + '🔘' + '▬'.repeat(Format.PROGRESS_WIDTH - 1 - knob);
  }

  /**
   * Builds a masked link. Discord breaks on unescaped brackets in the label and
   * silently truncates overlong fields, so the title is clamped and escaped.
   */
  public static trackLink(title: string, uri: string | undefined, maxLength = 60): string {
    const safe = Format.truncate(title, maxLength).replace(/([[\]])/g, '\\$1');
    return uri ? `[${safe}](${uri})` : safe;
  }

  public static truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  /** Maps a Lavalink `sourceName` to a human label. */
  public static source(sourceName: string | undefined): string {
    if (!sourceName) return 'Unknown';
    const labels: Record<string, string> = {
      youtube: 'YouTube',
      youtubemusic: 'YouTube Music',
      spotify: 'Spotify',
      soundcloud: 'SoundCloud',
      applemusic: 'Apple Music',
      deezer: 'Deezer',
      bandcamp: 'Bandcamp',
      twitch: 'Twitch',
      http: 'Direct link',
    };
    return labels[sourceName.toLowerCase()] ?? sourceName;
  }
}
