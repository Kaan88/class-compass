/** Imported theme packages (core, S14g, D-158): admin import, preview, enable, export, delete. */
import { defineServerModule } from '../manifest.ts';
import { registerThemeRoutes } from './routes.ts';

export const themesManifest = defineServerModule({ key: 'themes', policyKey: null, routes: registerThemeRoutes });
