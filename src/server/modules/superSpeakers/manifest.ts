/**
 * Super Speakers (S12, SSP-1..12, D-127..D-134): school-wide English points. A school-wide module
 * (one administrator switch, D-127): scorer links and the scorer app (search, +1, undo, offline
 * outbox), board links and the big-screen board with live updates (SSE), the admin page with the
 * award log and the weekly history, the S11 report section and timeline, and the S13c Super Speakers
 * badges through the activity hook.
 */
import { setDisplayResolver, setScorerResolver } from '../../lib/http.ts';
import { defineServerModule } from '../manifest.ts';
import { superSpeakersCommands } from './commands.ts';
import { speakersReportSection, speakersTimeline } from './history.ts';
import { registerSpeakersRoutes } from './routes.ts';
import { resolveDisplay, resolveScorer } from './service.ts';

export const superSpeakersManifest = defineServerModule({
  key: 'superSpeakers',
  policyKey: 'superSpeakers',
  commands: superSpeakersCommands,
  routes: (app, deps) => {
    // Every scorer and board request re-checks its link, so revoke and regenerate act at once (D-128).
    setScorerResolver(resolveScorer);
    setDisplayResolver(resolveDisplay);
    registerSpeakersRoutes(app, deps);
  },
  reports: [{ key: 'superSpeakers', order: 95, build: speakersReportSection }],
  timeline: [{ key: 'superSpeakers', order: 95, build: speakersTimeline }],
});
