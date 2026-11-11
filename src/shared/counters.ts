/**
 * Counter constants shared by client and server (CNT-1..12). The English reminder preset is data:
 * every label and response below is teacher-editable afterwards (EN/TR); the defaults only seed a
 * new preset counter.
 */
import type { LocalizedTextValue } from './contracts/define.ts';

export const COUNTER_KINDS = ['english_reminders', 'custom'] as const;
export const COUNTER_SCOPES = ['lesson', 'student', 'both'] as const;
export const RESET_PERIODS = ['week', 'term', 'never'] as const;
export const RESPONSE_KINDS = ['message', 'no_breaktime', 'class_reset', 'practice_challenge', 'custom'] as const;
/**
 * Colour keys for counters. Teachers pick a name; the client maps it to semantic CSS tokens
 * (`--cc-counter-<key>`), never to raw colours (THM-4). 'accent' follows the class theme.
 */
export const COUNTER_COLOURS = ['accent', 'teal', 'plum', 'rust', 'leaf', 'berry'] as const;

export type CounterKind = (typeof COUNTER_KINDS)[number];
export type CounterScope = (typeof COUNTER_SCOPES)[number];
export type ResetPeriod = (typeof RESET_PERIODS)[number];
export type ResponseKind = (typeof RESPONSE_KINDS)[number];
export type CounterColour = (typeof COUNTER_COLOURS)[number];

export interface CounterLabels {
  /** Main bar label, e.g. "Our English Time". */
  main: LocalizedTextValue;
  /** Supporting text template; `{count}` and `{limit}` are filled in, e.g. "{count} / {limit} Turkish reminders". */
  supporting: LocalizedTextValue;
  /** Individual counter label on student cards, e.g. "Turkish reminders". */
  individual: LocalizedTextValue;
}

export interface ThresholdResponse {
  id: string;
  label: LocalizedTextValue;
  message: LocalizedTextValue;
  /** Play the mascot's single, gentle animation with the message (THM-5 rules apply). */
  mascot: boolean;
  kind: ResponseKind;
}

export const DEFAULT_SEGMENTS = 10;
export const MAX_SEGMENTS = 30;
export const MAX_RESPONSES = 8;
/** At most three visual levels above neutral: amber, deeper amber, red (CNT-6). */
export const MAX_LEVELS = 3;
/** Client-side double-tap guard per student and counter (CNT-5, UX-11). */
export const DOUBLE_TAP_MS = 700;
/** A class reset of the bar can be undone for this long, and only until the next tap on that counter (S22a, D-175). */
export const RESET_UNDO_MS = 10 * 60_000;

export const ENGLISH_LABELS: CounterLabels = {
  main: { en: 'Our English Time', tr: 'İngilizce Zamanımız' },
  supporting: { en: '{count} / {limit} Turkish reminders', tr: '{count} / {limit} Türkçe hatırlatma' },
  individual: { en: 'Turkish reminders', tr: 'Türkçe hatırlatmaları' },
};

/** Default visual levels for English reminders: 0–1 neutral, ≥2 amber, ≥4 deeper amber, ≥6 red. */
export const ENGLISH_THRESHOLDS = [2, 4, 6];

export const ENGLISH_RESPONSES: ThresholdResponse[] = [
  {
    id: 'back-to-english',
    kind: 'message',
    mascot: true,
    label: { en: 'Back to English', tr: 'İngilizceye dönüyoruz' },
    message: { en: 'We reached {limit} reminders. Let’s take a breath and carry on in English together!', tr: '{limit} hatırlatmaya ulaştık. Derin bir nefes alalım ve birlikte İngilizce devam edelim!' },
  },
  {
    id: 'no-breaktime',
    kind: 'no_breaktime',
    mascot: false,
    label: { en: 'No breaktime', tr: 'Teneffüs yok' },
    message: { en: 'We reached {limit} reminders. Today we use the breaktime to practise English.', tr: '{limit} hatırlatmaya ulaştık. Bugün teneffüste İngilizce pratik yapacağız.' },
  },
  {
    id: 'class-reset',
    kind: 'class_reset',
    mascot: true,
    label: { en: 'Class reset', tr: 'Sınıf yeniden başlıyor' },
    message: { en: 'Fresh start! The class bar starts again from zero. Let’s keep it in English.', tr: 'Yeni bir başlangıç! Sınıf çubuğu sıfırdan başlıyor. İngilizce devam edelim.' },
  },
  {
    id: 'practice-challenge',
    kind: 'practice_challenge',
    mascot: true,
    label: { en: 'English practice challenge', tr: 'İngilizce pratik görevi' },
    message: { en: 'Challenge time: everyone says one full sentence in English before we go on!', tr: 'Görev zamanı: devam etmeden önce herkes İngilizce tam bir cümle söylesin!' },
  },
];
export const ENGLISH_ACTIVE_RESPONSE = 'back-to-english';

/** Default labels of a new custom counter called `name`. */
export function customLabels(name: LocalizedTextValue): CounterLabels {
  return {
    main: { ...name },
    supporting: { en: '{count} / {limit}', tr: '{count} / {limit}' },
    individual: { ...name },
  };
}

/** Fill `{count}` / `{limit}` in a label template. */
export function fillCounterText(template: string, vars: { count: number; limit: number }): string {
  return template.replace(/\{(count|limit)\}/g, (_m, k: 'count' | 'limit') => String(vars[k]));
}

/** Is this subject the English subject? (auto-creates the English preset, CNT-1). */
export function isEnglishSubject(name: LocalizedTextValue): boolean {
  const en = name.en?.trim().toLocaleLowerCase('en') ?? '';
  const tr = name.tr?.trim().toLocaleLowerCase('tr') ?? '';
  return en === 'english' || tr === 'ingilizce';
}

/** Individual-count thresholds must be 0–3 strictly ascending whole numbers >= 1 (CNT-6). */
export function validThresholds(ts: readonly number[]): boolean {
  if (ts.length > MAX_LEVELS) return false;
  return ts.every((t, i) => Number.isInteger(t) && t >= 1 && (i === 0 || t > ts[i - 1]!));
}
