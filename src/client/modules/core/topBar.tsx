/**
 * Classroom top-bar slots (S13b items 3 and 4): the quote of the day (centre) and the weather (right).
 * - Quote: original sayings (src/shared/quotes.ts) in the classroom language, chosen from the class
 *   and the class's local date, so it is the same all day on every screen of that class; the teacher
 *   switches it off per class (`quoteEnabled`).
 * - Weather: the school's location (admin setting) through the server (cached 30 min); a child-friendly
 *   picture, the temperature in °C and one word. Offline, slow or switched off → nothing is shown.
 * Both render nothing when they have nothing to say, so the slot hides (S13a, CSS :empty).
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WeatherKind } from '../../../shared/classDisplay.ts';
import { classroomWeather } from '../../../shared/contracts/weather.ts';
import { localDate } from '../../../domain/dates.ts';
import { quoteFor } from '../../../shared/quotes.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { registerTopBarSlot } from '../classroomHooks.ts';
import type { ClassroomContext } from '../types.ts';

function useLocalDate(tz: string): string {
  const [day, setDay] = useState(() => localDate(Date.now(), tz));
  useEffect(() => {
    const h = setInterval(() => setDay(localDate(Date.now(), tz)), 60_000);
    return () => clearInterval(h);
  }, [tz]);
  return day;
}

export function QuoteOfTheDay({ context, locale }: { context: ClassroomContext; locale: 'en' | 'tr' }) {
  const { t } = useI18n();
  const day = useLocalDate(context.timezone);
  if (context.quoteEnabled === false) return null;
  return (
    <figure className="cc-quote" data-testid="quote-of-the-day">
      <figcaption className="cc-visually-hidden">{t('quote.label')}</figcaption>
      <blockquote className="cc-quote__text">{quoteFor(context.classId, day, locale)}</blockquote>
    </figure>
  );
}

/** Child-friendly weather pictures in a 48×48 box, coloured with theme tokens. */
export function WeatherIcon({ kind, isDay }: { kind: WeatherKind; isDay: boolean }) {
  const sun = isDay ? <circle cx="18" cy="18" r="9" className="cc-wx__sun" /> : <path d="M22 8a11 11 0 1 0 10 15A9 9 0 0 1 22 8z" className="cc-wx__moon" />;
  const cloud = (dy = 0, cls = 'cc-wx__cloud') => <path d={`M14 ${36 + dy}h22a7 7 0 0 0 0-14 10 10 0 0 0-19-2 7 7 0 0 0-3 16z`} className={cls} />;
  const drops = (n: number) =>
    Array.from({ length: n }, (_, i) => <line key={i} x1={17 + i * 7} y1="40" x2={15 + i * 7} y2="46" className="cc-wx__drop" />);
  return (
    <svg className="cc-wx" viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" focusable="false">
      {kind === 'sunny' ? (
        <>
          {isDay
            ? [0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="24" y1="5" x2="24" y2="10" transform={`rotate(${a} 24 24)`} className="cc-wx__ray" />)
            : null}
          {isDay ? <circle cx="24" cy="24" r="10" className="cc-wx__sun" /> : <path d="M28 10a14 14 0 1 0 12 19A11 11 0 0 1 28 10z" className="cc-wx__moon" />}
        </>
      ) : kind === 'partlyCloudy' ? (
        <>
          {sun}
          {cloud(4)}
        </>
      ) : kind === 'cloudy' ? (
        <>
          {cloud(-8, 'cc-wx__cloud cc-wx__cloud--back')}
          {cloud(2)}
        </>
      ) : kind === 'fog' ? (
        <>
          {cloud(-6)}
          {[36, 41, 46].map((y) => (
            <line key={y} x1="8" y1={y} x2="40" y2={y} className="cc-wx__fog" />
          ))}
        </>
      ) : kind === 'drizzle' ? (
        <>
          {cloud(-4)}
          {drops(2)}
        </>
      ) : kind === 'rain' ? (
        <>
          {cloud(-4)}
          {drops(4)}
        </>
      ) : kind === 'snow' ? (
        <>
          {cloud(-4)}
          {[16, 24, 32].map((x) => (
            <circle key={x} cx={x} cy="43" r="2.2" className="cc-wx__snow" />
          ))}
        </>
      ) : (
        <>
          {cloud(-4)}
          <path d="M24 34l-5 8h5l-3 6 9-10h-5l3-4z" className="cc-wx__bolt" />
        </>
      )}
    </svg>
  );
}

export function WeatherNow({ context }: { context: ClassroomContext; locale: 'en' | 'tr' }) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['classroom', 'weather'],
    queryFn: () => call(classroomWeather, {}),
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: false,
    meta: { context: context.id },
  });
  const w = q.data;
  if (!w || !w.available || !w.kind || w.temperatureC === null) return null;
  const word = t(`weather.${w.kind}`);
  return (
    <div className="cc-weather" data-testid="weather" title={word}>
      <WeatherIcon kind={w.kind} isDay={w.isDay ?? true} />
      <span className="cc-weather__temp">{t('weather.temperature', { value: w.temperatureC })}</span>
      <span className="cc-weather__word">{word}</span>
    </div>
  );
}

let registered = false;
/** Called once by the core client manifest. */
export function registerCoreTopBar() {
  if (registered) return;
  registered = true;
  registerTopBarSlot({ key: 'core.quote', slot: 'quote', order: 10, Component: QuoteOfTheDay });
  registerTopBarSlot({ key: 'core.weather', slot: 'weather', order: 10, Component: WeatherNow });
}
