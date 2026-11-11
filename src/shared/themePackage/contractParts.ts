/**
 * The parts of the theme package vocabulary that the shared themes contract names: the report's issue
 * codes (S14g, D-158) and the key slug. In a file of their own (S26c, D-191) because every page that
 * shows an imported theme loads that contract (`publicCustomTheme`), the student page too, while the
 * package schema (`schema.ts`) and the checks (`validate.ts`) are needed only when a package is drawn
 * (a lazy chunk), checked or stored. `schema.ts` and `validate.ts` re-export them.
 */
import { z } from 'zod';
import { THEME_SLUG } from '../themes.ts';

export const THEME_ISSUE_CODES = ['TOO_LARGE', 'NOT_JSON', 'SCHEMA', 'KEY_BUILTIN', 'CONTRAST', 'SOUND', 'SVG', 'MASCOT_POSES_SAME', 'ART_FROM_BASE', 'SILENT', 'SCRIM_DEFAULT', 'MASCOT_FROM_UNUSED'] as const;
export type ThemeIssueCode = (typeof THEME_ISSUE_CODES)[number];

export const ThemeSlug = z.string().regex(THEME_SLUG, 'a slug: 3-32 lower-case letters, digits and single hyphens, starting with a letter');
