/** Student list importer (core, S9: IMP-1..7, D-013): paste/CSV/Excel/Word/PDF/OCR → preview → commit → revert. */
import { defineServerModule } from '../manifest.ts';
import { registerImportRoutes } from './routes.ts';

export const importManifest = defineServerModule({ key: 'import', policyKey: null, routes: registerImportRoutes });
