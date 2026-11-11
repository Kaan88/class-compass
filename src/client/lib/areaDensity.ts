import { useEffect } from 'react';
import { DEFAULT_AREA_DENSITY, type AreaDensity } from '../../shared/contracts/auth.ts';

/**
 * S22d (D-178): Compact / Normal / Large in the teacher and admin areas. The account's choice (`me.density`,
 * user setting `area.density`) is put on `<html data-area-density>` while a teacher or admin layout is
 * mounted, so dialogs portalled to `<body>` follow it too; `app.css` changes only the layout variables
 * `--cc-area-*` (spacing, table cell padding, card padding) for Compact and Large. The classroom screen,
 * the student page and Super Speakers never mount these layouts and keep their own sizes.
 */
export const AREA_DENSITY_ATTR = 'areaDensity';

export function applyAreaDensity(density: AreaDensity | null): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (density === null) delete html.dataset[AREA_DENSITY_ATTR];
  else html.dataset[AREA_DENSITY_ATTR] = density;
}

/** Called by `TeacherLayout` and `AdminLayout`; removes the attribute again when the layout unmounts. */
export function useAreaDensity(density: AreaDensity | undefined): void {
  const value = density ?? DEFAULT_AREA_DENSITY;
  useEffect(() => {
    applyAreaDensity(value);
    return () => applyAreaDensity(null);
  }, [value]);
}
