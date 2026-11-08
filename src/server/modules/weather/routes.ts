import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/weather.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { classroomWeather } from './service.ts';

export function registerWeatherRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.classroomWeather, (ctx) => classroomWeather(ctx));
}
