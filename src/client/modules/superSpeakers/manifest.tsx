/**
 * Super Speakers (S12, D-127): a school-wide module. It adds nothing to the classroom screen or the
 * teacher area: scorers use the separate scorer app (`/p`, scorer.html), the board is its own page
 * (`/board`, board.html) and administrators manage it on Admin → Super Speakers.
 */
import { defineClientModule } from '../types.ts';

export const superSpeakersClientManifest = defineClientModule({
  key: 'superSpeakers',
  policyKey: 'superSpeakers',
  i18nNamespace: 'speakers',
});
