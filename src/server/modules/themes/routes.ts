import type { FastifyInstance } from 'fastify';
import * as C from '../../../shared/contracts/themes.ts';
import type { AppDeps } from '../../lib/context.ts';
import { route } from '../../lib/http.ts';
import { availableThemes, createTheme, deleteTheme, getTheme, listThemes, publicTheme, replaceTheme, setThemeStatus, validateTheme } from './service.ts';

export function registerThemeRoutes(app: FastifyInstance, deps: AppDeps) {
  route(app, deps, C.listCustomThemes, (ctx) => listThemes(ctx));
  // Registered before `/:key` routes so "validate" is never read as a key.
  route(app, deps, C.validateCustomTheme, (ctx, input) => validateTheme(ctx, input));
  route(app, deps, C.getCustomTheme, (ctx, input) => getTheme(ctx, input));
  route(app, deps, C.createCustomTheme, (ctx, input) => createTheme(ctx, input));
  route(app, deps, C.replaceCustomTheme, (ctx, input) => replaceTheme(ctx, input));
  route(app, deps, C.enableCustomTheme, (ctx, input) => setThemeStatus(ctx, input.key, 'enabled'));
  route(app, deps, C.disableCustomTheme, (ctx, input) => setThemeStatus(ctx, input.key, 'disabled'));
  route(app, deps, C.deleteCustomTheme, (ctx, input) => deleteTheme(ctx, input));
  route(app, deps, C.availableThemes, (ctx) => availableThemes(ctx));
  route(app, deps, C.publicCustomTheme, (ctx, input) => publicTheme(ctx, input));
}
