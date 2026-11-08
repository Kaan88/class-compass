/**
 * Classroom weather (S13b, D-106). The server asks Open-Meteo (free, no key) for the current weather at
 * the school's configured coordinates — nothing else is sent: no student data, no school name. Answers
 * are cached for 30 minutes per location (failures for 5 minutes, so an offline server does not retry
 * on every poll), each request gives up after 5 seconds, and a server without internet just answers
 * `available: false`: the classroom widget then hides quietly. The fetcher is injectable (`deps.weatherFetch`).
 */
import { weatherKindOf } from '../../../shared/classDisplay.ts';
import type { ClassroomWeather } from '../../../shared/contracts/weather.ts';
import type { AppDeps } from '../../lib/context.ts';
import { getSchoolSettings } from '../school/policy.ts';

export const WEATHER_TTL_MS = 30 * 60_000;
export const WEATHER_FAIL_TTL_MS = 5 * 60_000;
export const WEATHER_TIMEOUT_MS = 5_000;

/** The parts of Open-Meteo's `current` block we use. */
export interface CurrentWeather {
  temperature_2m: number;
  weather_code: number;
  is_day: number;
}
export type WeatherFetch = (url: string, signal: AbortSignal) => Promise<CurrentWeather>;

const UNAVAILABLE: ClassroomWeather = { available: false, kind: null, temperatureC: null, isDay: null };

/** Default fetcher: plain HTTPS GET, JSON answer. */
export const httpWeatherFetch: WeatherFetch = async (url, signal) => {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
  const body = (await res.json()) as { current?: CurrentWeather };
  if (!body.current) throw new Error('weather answer without current');
  return body.current;
};

interface CacheEntry {
  at: number;
  ttl: number;
  value: ClassroomWeather;
}
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ClassroomWeather>>();

/** Tests start from an empty cache. */
export function clearWeatherCache() {
  cache.clear();
  inflight.clear();
}

export function weatherUrl(base: string, lat: number, lon: number): string {
  const u = new URL(base);
  u.searchParams.set('latitude', lat.toFixed(4));
  u.searchParams.set('longitude', lon.toFixed(4));
  u.searchParams.set('current', 'temperature_2m,weather_code,is_day');
  u.searchParams.set('timezone', 'auto');
  return u.toString();
}

async function fetchWithTimeout(deps: AppDeps, url: string): Promise<ClassroomWeather> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), WEATHER_TIMEOUT_MS);
  try {
    const fetcher = deps.weatherFetch ?? httpWeatherFetch;
    const cur = await Promise.race([
      fetcher(url, ac.signal),
      new Promise<never>((_, reject) => ac.signal.addEventListener('abort', () => reject(new Error('weather timeout')), { once: true })),
    ]);
    if (typeof cur.temperature_2m !== 'number' || typeof cur.weather_code !== 'number') throw new Error('weather answer incomplete');
    return { available: true, kind: weatherKindOf(cur.weather_code), temperatureC: Math.round(cur.temperature_2m), isDay: cur.is_day !== 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function classroomWeather(deps: AppDeps): Promise<ClassroomWeather> {
  const s = getSchoolSettings(deps.db);
  if (!s.weatherEnabled) return UNAVAILABLE;
  const url = weatherUrl(deps.config.WEATHER_API_URL, s.weatherLatitude, s.weatherLongitude);
  const now = deps.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  const running = inflight.get(url);
  if (running) return running;
  const p = fetchWithTimeout(deps, url)
    .then((value) => {
      cache.set(url, { at: deps.now(), ttl: WEATHER_TTL_MS, value });
      return value;
    })
    .catch(() => {
      cache.set(url, { at: deps.now(), ttl: WEATHER_FAIL_TTL_MS, value: UNAVAILABLE });
      return UNAVAILABLE;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
