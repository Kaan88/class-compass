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
| Badge icons (94) and tier frames (S13c) | Original SVG paths drawn for Class Compass (`src/client/achievements/icons.tsx`), stroked and filled with theme tokens. No third-party icon set (D-125) | Part of this code base |
| Avatars: 120+ ready-made characters and the layered creator parts (S13c) | Original SVG shapes drawn in code (`src/client/avatars/AvatarArt.tsx`) from a catalogue (`src/shared/avatars.ts`), coloured with theme tokens. Not copied from or imitating South Park or any other show or game (D-125) | Part of this code base |

## Text

| Asset | Source | Licence |
|---|---|---|
| Quote of the day (125 English, 125 Turkish) | Original sayings written for Class Compass (`src/shared/quotes.ts`); no quotations of people or books | Part of this code base |
| Risky-word lists, English and Turkish (S13c) | Written for Class Compass (`src/shared/text/riskyWords.ts`). No third-party list (LDNOOBW or other) was copied; administrators and teachers add their own words (D-123) | Part of this code base |
| Everyday word lists for the nonsense check, English and Turkish (S13c) | Written for Class Compass (`src/shared/text/wordsEn.ts`, `wordsTr.ts`) from common school vocabulary | Part of this code base |
| Text-check test corpus (S13c) | Invented child-like sentences and gibberish samples (`tests/domain/text-corpus.ts`); fictional | Part of this code base |

## Data services (not assets, listed for completeness)

| Service | Use | Terms |
|---|---|---|
| Open-Meteo (`api.open-meteo.com`) | Current weather at the school's coordinates (D-106), cached 30 minutes | Free for non-commercial use, no key; only coordinates are sent |
