/**
 * Mascot, decoration and scope now live in the theme registry (src/client/themes, D-070). This file
 * re-exports them so UI components keep one import path.
 */
export { Mascot, ThemeBackdrop, ThemeDecoration, ThemeIllustration, ThemeScope } from '../themes/index.tsx';
