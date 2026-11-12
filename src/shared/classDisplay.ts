/**
 * Class display settings added in S13b (feedback round 1b): sound volume, quote of the day, the
 * time's-up announcement, and the school's weather location. Shared by the server (columns,
 * validation) and the client (settings screens, the classroom).
 */

/** What the classroom says or plays when a timer reaches 0 (D-107). */
export const TIME_UP_SOUNDS = ['voice', 'clip', 'chime', 'off'] as const;
export type TimeUpSound = (typeof TIME_UP_SOUNDS)[number];

/** Per-class sound volume in percent (0 = silent, like the sounds switch off). */
export const DEFAULT_SOUND_VOLUME = 80;

/** The spoken announcement (English voice by owner decision, D-107). */
export const TIME_UP_PHRASE = "Time's up! Time's up!";

/**
 * Default weather location for a new install: a neutral example place (Kızılay, Ankara); each school sets
 * its own under Admin → School settings, and an existing school keeps the place it has. Coordinates at city
 * precision; Open-Meteo's model grid is a few kilometres wide, so a closer point changes nothing.
 */
export const DEFAULT_WEATHER = { label: 'Ankara, Kızılay', latitude: 39.92, longitude: 32.85 } as const;

/** Child-friendly weather kinds (icon + word, never colour alone). */
export const WEATHER_KINDS = ['sunny', 'partlyCloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'storm'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/** WMO weather interpretation codes (Open-Meteo `weather_code`) → our kinds. */
export function weatherKindOf(code: number): WeatherKind {
  if (code <= 1) return 'sunny';
  if (code === 2) return 'partlyCloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloudy';
}
