/** Classroom weather from Open-Meteo for the school's location (S13b, D-106). Core, school-wide (admin setting). */
import { defineServerModule } from '../manifest.ts';
import { registerWeatherRoutes } from './routes.ts';

export const weatherManifest = defineServerModule({ key: 'weather', policyKey: null, routes: registerWeatherRoutes });
