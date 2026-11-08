# Third-party and generated assets

Class Compass ships no copyrighted media. This file lists every non-code asset and where it comes from.

## Audio (S13b, D-110)

| Asset | Source | Licence |
|---|---|---|
| All theme sound cues (tap, undo, stage change, time's up chime, threshold, assistant check, group shuffle, drum roll, reveal, fanfare, clapping, fireworks, point) | Synthesized at run time with WebAudio from the parameters in `src/client/themes/soundPack.ts` and each theme's `index.ts` (oscillators and band-passed generated noise). No audio files. | Part of this code base |
| "Time's up! Time's up!" voice | Spoken by the browser's own speech synthesis (`speechSynthesis`) on the classroom computer. Nothing is downloaded or shipped. | Provided by the operating system / browser |
| Teacher's time's-up clip | Recorded or chosen by the teacher, stored as their own file (`teacher_sound`). Not shipped. | The teacher's own recording |

No CC0 audio is currently included. If one is ever added, list it here with its URL, author and licence.

## Images and icons

| Asset | Source | Licence |
|---|---|---|
| Mascots, illustrations, decorations, patterns, weather pictures | Original SVG drawn in code (`src/client/themes/*/art.tsx`, `src/client/modules/core/topBar.tsx`), coloured with theme tokens | Part of this code base |
| UI icons | Original SVG paths in `src/client/ui/icons.tsx` | Part of this code base |

## Text

| Asset | Source | Licence |
|---|---|---|
| Quote of the day (125 English, 125 Turkish) | Original sayings written for Class Compass (`src/shared/quotes.ts`); no quotations of people or books | Part of this code base |

## Data services (not assets, listed for completeness)

| Service | Use | Terms |
|---|---|---|
| Open-Meteo (`api.open-meteo.com`) | Current weather at the school's coordinates (D-106), cached 30 minutes | Free for non-commercial use, no key; only coordinates are sent |
