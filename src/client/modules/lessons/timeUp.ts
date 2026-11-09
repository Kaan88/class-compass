/**
 * Time's up announcement (S13b, D-107). Per class the teacher chooses:
 * - 'voice': "Time's up! Time's up!" spoken by the browser (speechSynthesis) with an English voice
 *   (en-GB preferred, then en-US, then any en-*). No English voice → the theme chime;
 * - 'clip': the teacher's own recorded clip (preloaded); missing or unplayable → the chime;
 * - 'chime': the theme's timeUp cue;
 * - 'off': silent (the visual signal stays).
 * Nothing plays when the class or this device has sounds off (THM-5).
 */
import { TIME_UP_PHRASE, type TimeUpSound } from '../../../shared/classDisplay.ts';
import { soundsAllowed, type DisplayState } from '../../lib/display.ts';
import { playThemeSound, sounds, syncSoundSwitches } from '../../themes/index.tsx';
import type { ThemeDefinition } from '../../themes/types.ts';

export const TIME_UP_CLIP_URL = '/api/classroom/time-up-clip';

export type TimeUpPlan = 'voice' | 'clip' | 'chime' | 'none';

/** Pure decision (tested): what actually plays for a setting and what this device can do. */
export function planTimeUp(setting: TimeUpSound, can: { sounds: boolean; englishVoice: boolean; clip: boolean }): TimeUpPlan {
  if (!can.sounds || setting === 'off') return 'none';
  if (setting === 'voice') return can.englishVoice ? 'voice' : 'chime';
  if (setting === 'clip') return can.clip ? 'clip' : 'chime';
  return 'chime';
}

type VoiceLike = Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService'>;
/** The best English voice: en-GB, then en-US, then any en-*; local voices first (work offline). */
export function pickEnglishVoice<V extends VoiceLike>(voices: readonly V[]): V | null {
  const en = voices.filter((v) => /^en[-_]/iu.test(v.lang) || v.lang.toLowerCase() === 'en');
  const rank = (v: V) => (/^en[-_]gb/iu.test(v.lang) ? 0 : /^en[-_]us/iu.test(v.lang) ? 1 : 2) * 2 + (v.localService ? 0 : 1);
  return [...en].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function speech(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

/**
 * The voice list, kept fresh (S14a, D-145): Chrome and Safari fill it asynchronously and change it
 * later (`voiceschanged`), so the first time's up of the day must not see an empty or stale list.
 */
let voiceCache: SpeechSynthesisVoice[] = [];
let watchingVoices = false;
export function currentVoices(): SpeechSynthesisVoice[] {
  const synth = speech();
  if (!synth) return [];
  if (!watchingVoices) {
    watchingVoices = true;
    try {
      synth.addEventListener('voiceschanged', () => {
        voiceCache = synth.getVoices();
      });
    } catch {
      /* older engines: getVoices() below is still asked every time */
    }
  }
  const now = synth.getVoices();
  if (now.length) voiceCache = now;
  return voiceCache;
}

function speak(voice: SpeechSynthesisVoice): boolean {
  const synth = speech();
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
  try {
    const u = new SpeechSynthesisUtterance(TIME_UP_PHRASE);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.95;
    u.volume = Math.max(0.1, Math.min(1, sounds.getVolume() / 100));
    synth.cancel();
    sounds.duckFor(2500);
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** Fetch the clip ahead of time when the class uses it, so time's up is not delayed. */
export function preloadTimeUp(setting: TimeUpSound, hasClip: boolean) {
  if (setting === 'clip' && hasClip) void sounds.preloadClip(TIME_UP_CLIP_URL);
  // Some browsers fill the voice list asynchronously: ask once so it is ready.
  if (setting === 'voice') currentVoices();
}

/** Plays the class's time's-up announcement; returns what was played. */
export function announceTimeUp(display: DisplayState, theme: ThemeDefinition): TimeUpPlan {
  const voice = pickEnglishVoice(currentVoices());
  const plan = planTimeUp(display.timeUpSound, { sounds: soundsAllowed(display), englishVoice: voice !== null, clip: display.timeUpClip });
  const chime = () => playThemeSound(display, theme, 'timeUp');
  if (plan === 'voice' && voice) {
    if (!speak(voice)) chime();
  } else if (plan === 'clip') {
    syncSoundSwitches(display);
    void sounds.playClip(TIME_UP_CLIP_URL).then((ok) => {
      if (!ok) chime();
    });
  } else if (plan === 'chime') {
    chime();
  }
  return plan;
}
