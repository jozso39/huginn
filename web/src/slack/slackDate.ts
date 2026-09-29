// Slack's <!date^…> tokens, rendered the way Slack does: English dates with
// ordinals, the year only when it is more than six months away, times in the
// viewer's own clock format and timezone.

const DAY_MS = 86_400_000;
const SIX_MONTHS_MS = 182 * DAY_MS;

const ordinal = (day: number): string => {
  const tens = day % 100;

  if (tens >= 11 && tens <= 13) {
    return `${day}th`;
  }

  return `${day}${['th', 'st', 'nd', 'rd'][day % 10] ?? 'th'}`;
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const month = (date: Date, style: 'long' | 'short') =>
  date.toLocaleString('en-US', { month: style });

const withYear = (date: Date, now: Date) =>
  Math.abs(date.getTime() - now.getTime()) > SIX_MONTHS_MS;

const dateText = (date: Date, now: Date, style: 'num' | 'plain' | 'short' | 'long'): string => {
  const year = withYear(date, now) ? `, ${date.getFullYear()}` : '';

  switch (style) {
    case 'num':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    case 'short':
      return `${month(date, 'short')} ${date.getDate()}${year}`;
    case 'long':
      return `${date.toLocaleString('en-US', { weekday: 'long' })}, ${month(date, 'long')} ${ordinal(date.getDate())}${year}`;
    default:
      return `${month(date, 'long')} ${ordinal(date.getDate())}${year}`;
  }
};

const pretty = (date: Date, now: Date, fallback: string): string => {
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);

  return days === 0 ? 'today' : days === -1 ? 'yesterday' : days === 1 ? 'tomorrow' : fallback;
};

const ago = (date: Date, now: Date): string => {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  const abs = Math.abs(seconds);

  if (abs < 60) {
    return format.format(seconds, 'second');
  }

  if (abs < 3600) {
    return format.format(Math.round(seconds / 60), 'minute');
  }

  if (abs < 86_400) {
    return format.format(Math.round(seconds / 3600), 'hour');
  }

  if (abs < 30 * 86_400) {
    return format.format(Math.round(seconds / 86_400), 'day');
  }

  return format.format(Math.round(seconds / (30 * 86_400)), 'month');
};

const time = (date: Date, seconds: boolean) =>
  date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });

/** Fills a Slack date token string, e.g. "{date_long} at {time}". */
export const formatSlackDate = (unixSeconds: number, tokens: string, now = new Date()): string => {
  const date = new Date(unixSeconds * 1000);

  return tokens.replace(/\{(\w+)\}/g, (whole, token: string) => {
    switch (token) {
      case 'date_num':
        return dateText(date, now, 'num');
      case 'date':
        return dateText(date, now, 'plain');
      case 'date_short':
        return dateText(date, now, 'short');
      case 'date_long':
        return dateText(date, now, 'long');
      case 'date_pretty':
        return pretty(date, now, dateText(date, now, 'plain'));
      case 'date_short_pretty':
        return pretty(date, now, dateText(date, now, 'short'));
      case 'date_long_pretty':
        return pretty(date, now, dateText(date, now, 'long'));
      case 'time':
        return time(date, false);
      case 'time_secs':
        return time(date, true);
      case 'ago':
        return ago(date, now);
      default:
        return whole;
    }
  });
};
