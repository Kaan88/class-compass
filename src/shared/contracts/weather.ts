/** Classroom weather (S13b, D-106): a small, classroom-safe summary; nothing is shown when unavailable. */
import { z } from 'zod';
import { WEATHER_KINDS } from '../classDisplay.ts';
import { Empty, endpoint } from './define.ts';

export const ClassroomWeather = z.object({
  available: z.boolean(),
  kind: z.enum(WEATHER_KINDS).nullable(),
  temperatureC: z.number().int().nullable(),
  isDay: z.boolean().nullable(),
});
export type ClassroomWeather = z.infer<typeof ClassroomWeather>;

export const classroomWeather = endpoint({ method: 'GET', path: '/api/classroom/weather', access: 'classroom', input: Empty, output: ClassroomWeather });
