/**
 * Student achievements (S13c, D-121, D-122): the shared catalogue of default badges, the rule menu,
 * tiers, points, private level names and the badge icon keys. Server and client both read it.
 *
 * Fairness (D-122): every default is POSITIVE and EFFORT-based. There are no badges for attendance,
 * speed, rankings or comparing students, so being ill or away never costs a badge
 * (test-enforced by a scan of this file's rules).
 *
 * One award per student per achievement per class+subject. Tiers are separate achievements
 * ("Goal getter" bronze 3 / silver 5 / gold 10). Names and descriptions are `{ en, tr }` data,
 * shown in the class / student-page language.
 */
import type { LocalizedTextValue } from './contracts/define.ts';

export const ACHIEVEMENT_TIERS = ['bronze', 'silver', 'gold', 'none'] as const;
export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number];
/** Points for the optional private level path (D-121). */
export const TIER_POINTS: Record<AchievementTier, number> = { bronze: 1, silver: 3, gold: 5, none: 1 };

export const ACHIEVEMENT_CATEGORIES = ['goals', 'evidence', 'reflections', 'homework', 'skills', 'roles', 'secret', 'speakers', 'teacher', 'custom'] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export const ACHIEVEMENT_KINDS = ['auto', 'manual'] as const;
export type AchievementKind = (typeof ACHIEVEMENT_KINDS)[number];

/** Skills a rule can filter on; a goal's skill is its category icon (S13a lesson topics, D-101). */
export const ACHIEVEMENT_SKILLS = ['listening', 'reading', 'vocabulary', 'grammar', 'writing', 'speaking', 'phonics'] as const;
export type AchievementSkill = (typeof ACHIEVEMENT_SKILLS)[number];
export const SKILL_OF_CATEGORY_ICON: Record<string, AchievementSkill> = { ear: 'listening', book: 'reading', words: 'vocabulary', grammar: 'grammar', pen: 'writing', speech: 'speaking', letters: 'phonics' };

export const EVIDENCE_FILTER_KINDS = ['text', 'link', 'image', 'document', 'audio'] as const;
export type EvidenceFilterKind = (typeof EVIDENCE_FILTER_KINDS)[number];

/**
 * The rule menu (D-121). Each event counts something the student DID; `threshold` is the count to
 * reach. Streak events count weeks (reflections) or assignments (homework done on time) in a row;
 * a gap never takes a badge away. `speaker_points` counts Super Speakers points (S12, D-132), in the
 * class+subjects of the badge subject (English) only.
 */
export const RULE_EVENTS = [
  'goal_set',
  'goal_achieved',
  'self_assessment',
  'confidence_grew',
  'evidence',
  'evidence_skills',
  'reflection',
  'note',
  'reflection_week_streak',
  'homework_completed',
  'homework_on_time_streak',
  'skill_activity',
  'assistant_day',
  'assistant_all_duties',
  'secret_earned',
  'speaker_points',
] as const;
export type RuleEvent = (typeof RULE_EVENTS)[number];
/** Events whose rules may filter by skill / by evidence kind. */
export const SKILL_FILTER_EVENTS: readonly RuleEvent[] = ['goal_set', 'goal_achieved', 'evidence', 'skill_activity'];
export const KIND_FILTER_EVENTS: readonly RuleEvent[] = ['evidence'];
/**
 * Events that cannot fire yet. Empty since S12: Super Speakers points now feed `speaker_points`
 * (live points only; a badge already given is not taken back when a point is voided, D-132).
 */
export const INACTIVE_EVENTS: readonly RuleEvent[] = [];
/** Which module's data each event reads (the rule is skipped while that module is off for the class+subject). */
export const EVENT_SOURCE: Record<RuleEvent, 'goals' | 'homework' | 'assistant' | 'secretStudents' | 'speakers'> = {
  goal_set: 'goals',
  goal_achieved: 'goals',
  self_assessment: 'goals',
  confidence_grew: 'goals',
  evidence: 'goals',
  evidence_skills: 'goals',
  reflection: 'goals',
  note: 'goals',
  reflection_week_streak: 'goals',
  skill_activity: 'goals',
  homework_completed: 'homework',
  homework_on_time_streak: 'homework',
  assistant_day: 'assistant',
  assistant_all_duties: 'assistant',
  secret_earned: 'secretStudents',
  speaker_points: 'speakers',
};

export interface AchievementRule {
  event: RuleEvent;
  threshold: number;
  skill?: AchievementSkill;
  evidenceKind?: EvidenceFilterKind;
}

/** Badge icons (original SVG, `src/client/achievements/icons.tsx`); at least 80 (test-enforced). */
export const BADGE_ICONS = [
  'star', 'stars', 'rocket', 'book', 'books', 'bookOpen', 'headphones', 'pencil', 'pen', 'speech', 'speechTwo', 'medal', 'trophy', 'cup', 'ribbon',
  'crown', 'shield', 'heart', 'heartHands', 'bulb', 'musicNote', 'musicNotes', 'planet', 'moon', 'sun', 'comet', 'cloud', 'rainbow', 'umbrella', 'tree',
  'flower', 'leaf', 'seedling', 'mountain', 'flag', 'compass', 'map', 'magnifier', 'target', 'check', 'thumbsUp', 'clap', 'smile', 'handshake', 'gift',
  'balloon', 'cake', 'kite', 'ball', 'bike', 'boat', 'plane', 'train', 'robot', 'dice', 'puzzle', 'paint', 'brush', 'palette', 'camera',
  'microphone', 'notebook', 'letterA', 'abc', 'globe', 'flask', 'magnet', 'anchor', 'feather', 'wand', 'sparkle', 'gem', 'key', 'bell', 'lantern',
  'telescope', 'hourglass', 'clock', 'calendar', 'cat', 'dog', 'owl', 'fox', 'bear', 'rabbit', 'lion', 'elephant', 'fish', 'turtle', 'butterfly',
  'bee', 'ladder', 'mask', 'apple',
] as const;
export type BadgeIcon = (typeof BADGE_ICONS)[number];

export interface DefaultAchievement {
  key: string;
  name: LocalizedTextValue;
  description: LocalizedTextValue;
  icon: BadgeIcon;
  tier: AchievementTier;
  category: AchievementCategory;
  kind: AchievementKind;
  rule: AchievementRule | null;
}

type Def = [key: string, en: string, tr: string, enDesc: string, trDesc: string, icon: BadgeIcon, tier: AchievementTier, rule: AchievementRule | null];

const make = (category: AchievementCategory, rows: Def[]): DefaultAchievement[] =>
  rows.map(([key, en, tr, enDesc, trDesc, icon, tier, rule]) => ({ key, name: { en, tr }, description: { en: enDesc, tr: trDesc }, icon, tier, category, kind: rule ? 'auto' : 'manual', rule }));
const r = (event: RuleEvent, threshold: number, extra: Partial<AchievementRule> = {}): AchievementRule => ({ event, threshold, ...extra });

const SKILL_NAMES: Record<AchievementSkill, [string, string, BadgeIcon]> = {
  listening: ['Listening explorer', 'Dinleme kaşifi', 'headphones'],
  reading: ['Reading adventurer', 'Okuma maceracısı', 'bookOpen'],
  vocabulary: ['Word collector', 'Kelime koleksiyoncusu', 'abc'],
  grammar: ['Grammar builder', 'Dil bilgisi ustası', 'puzzle'],
  writing: ['Story writer', 'Hikâye yazarı', 'pencil'],
  speaking: ['Voice of the class', 'Sınıfın sesi', 'speech'],
  phonics: ['Sound detective', 'Ses dedektifi', 'letterA'],
};

export const DEFAULT_ACHIEVEMENTS: readonly DefaultAchievement[] = [
  ...make('goals', [
    ['goals.first', 'Goal setter', 'Hedef koyan', 'Set your first goal.', 'İlk hedefini koy.', 'flag', 'bronze', r('goal_set', 1)],
    ['goals.planner', 'Big planner', 'Büyük planlayıcı', 'Set 5 goals.', '5 hedef koy.', 'map', 'silver', r('goal_set', 5)],
    ['goals.firstReached', 'First goal reached', 'İlk hedefe ulaştın', 'Reach your first goal.', 'İlk hedefine ulaş.', 'target', 'bronze', r('goal_achieved', 1)],
    ['goals.getter3', 'Goal getter', 'Hedef avcısı', 'Reach 3 goals.', '3 hedefe ulaş.', 'medal', 'bronze', r('goal_achieved', 3)],
    ['goals.getter5', 'Goal getter', 'Hedef avcısı', 'Reach 5 goals.', '5 hedefe ulaş.', 'medal', 'silver', r('goal_achieved', 5)],
    ['goals.getter10', 'Goal getter', 'Hedef avcısı', 'Reach 10 goals.', '10 hedefe ulaş.', 'trophy', 'gold', r('goal_achieved', 10)],
    ['goals.selfCheck', 'Honest look', 'Kendime bakış', 'Say how sure you feel about a goal for the first time.', 'Bir hedefte ilk kez ne kadar emin olduğunu söyle.', 'magnifier', 'bronze', r('self_assessment', 1)],
    ['goals.selfCheck5', 'Thinking about my learning', 'Öğrenmemi düşünüyorum', 'Check how sure you feel 5 times.', '5 kez ne kadar emin olduğuna bak.', 'bulb', 'silver', r('self_assessment', 5)],
    ['goals.confidence', 'Growing confidence', 'Büyüyen güven', 'Feel more sure about a goal than before.', 'Bir hedefte eskisinden daha emin hisset.', 'seedling', 'silver', r('confidence_grew', 1)],
  ]),
  ...make('evidence', [
    ['evidence.first', 'First proof', 'İlk kanıt', 'Add your first piece of evidence.', 'İlk kanıtını ekle.', 'sparkle', 'bronze', r('evidence', 1)],
    ['evidence.picture', 'Picture it', 'Resmini çek', 'Add your first picture.', 'İlk resmini ekle.', 'camera', 'bronze', r('evidence', 1, { evidenceKind: 'image' })],
    ['evidence.voice', 'My voice', 'Benim sesim', 'Add your first voice recording.', 'İlk ses kaydını ekle.', 'microphone', 'bronze', r('evidence', 1, { evidenceKind: 'audio' })],
    ['evidence.document', 'Paper trail', 'Belge ustası', 'Add your first document.', 'İlk belgeni ekle.', 'notebook', 'bronze', r('evidence', 1, { evidenceKind: 'document' })],
    ['evidence.link', 'Web finder', 'Bağlantı bulucu', 'Add your first web link.', 'İlk web bağlantını ekle.', 'globe', 'bronze', r('evidence', 1, { evidenceKind: 'link' })],
    ['evidence.writing', 'In my words', 'Kendi sözlerimle', 'Write your first piece of evidence.', 'İlk yazılı kanıtını yaz.', 'feather', 'bronze', r('evidence', 1, { evidenceKind: 'text' })],
    ['evidence.collector5', 'Evidence collector', 'Kanıt toplayıcı', 'Add 5 pieces of evidence.', '5 kanıt ekle.', 'gem', 'bronze', r('evidence', 5)],
    ['evidence.collector15', 'Evidence collector', 'Kanıt toplayıcı', 'Add 15 pieces of evidence.', '15 kanıt ekle.', 'gem', 'silver', r('evidence', 15)],
    ['evidence.collector30', 'Evidence collector', 'Kanıt toplayıcı', 'Add 30 pieces of evidence.', '30 kanıt ekle.', 'crown', 'gold', r('evidence', 30)],
    ['evidence.skills3', 'All-rounder', 'Çok yönlü', 'Add evidence in 3 different skills.', '3 farklı beceride kanıt ekle.', 'compass', 'silver', r('evidence_skills', 3)],
    ['evidence.skills5', 'Skill explorer', 'Beceri kaşifi', 'Add evidence in 5 different skills.', '5 farklı beceride kanıt ekle.', 'telescope', 'gold', r('evidence_skills', 5)],
  ]),
  ...make('reflections', [
    ['reflections.first', 'First reflection', 'İlk düşünce', 'Write your first reflection.', 'İlk düşünceni yaz.', 'speechTwo', 'bronze', r('reflection', 1)],
    ['reflections.r5', 'Deep thinker', 'Derin düşünen', 'Write 5 reflections.', '5 düşünce yaz.', 'bulb', 'bronze', r('reflection', 5)],
    ['reflections.r10', 'Deep thinker', 'Derin düşünen', 'Write 10 reflections.', '10 düşünce yaz.', 'owl', 'silver', r('reflection', 10)],
    ['reflections.r25', 'Deep thinker', 'Derin düşünen', 'Write 25 reflections.', '25 düşünce yaz.', 'lantern', 'gold', r('reflection', 25)],
    ['reflections.week3', 'Steady thinker', 'Düzenli düşünen', 'Write reflections 3 weeks in a row.', '3 hafta üst üste düşünce yaz.', 'calendar', 'silver', r('reflection_week_streak', 3)],
    ['reflections.week6', 'Steady thinker', 'Düzenli düşünen', 'Write reflections 6 weeks in a row.', '6 hafta üst üste düşünce yaz.', 'hourglass', 'gold', r('reflection_week_streak', 6)],
    ['reflections.note', 'Note keeper', 'Not tutan', 'Write your first note on a goal.', 'Bir hedefe ilk notunu yaz.', 'pen', 'bronze', r('note', 1)],
  ]),
  ...make('homework', [
    ['homework.first', 'Homework hero', 'Ödev kahramanı', 'Complete your first homework.', 'İlk ödevini tamamla.', 'check', 'bronze', r('homework_completed', 1)],
    ['homework.done5', 'Homework hero', 'Ödev kahramanı', 'Complete 5 homework tasks.', '5 ödev tamamla.', 'shield', 'bronze', r('homework_completed', 5)],
    ['homework.done10', 'Homework hero', 'Ödev kahramanı', 'Complete 10 homework tasks.', '10 ödev tamamla.', 'shield', 'silver', r('homework_completed', 10)],
    ['homework.done25', 'Homework hero', 'Ödev kahramanı', 'Complete 25 homework tasks.', '25 ödev tamamla.', 'trophy', 'gold', r('homework_completed', 25)],
    ['homework.row3', 'On a roll', 'Seri yakaladın', 'Complete 3 homework tasks on time in a row.', 'Üst üste 3 ödevi zamanında tamamla.', 'ladder', 'bronze', r('homework_on_time_streak', 3)],
    ['homework.row5', 'On a roll', 'Seri yakaladın', 'Complete 5 homework tasks on time in a row.', 'Üst üste 5 ödevi zamanında tamamla.', 'rocket', 'silver', r('homework_on_time_streak', 5)],
    ['homework.row10', 'On a roll', 'Seri yakaladın', 'Complete 10 homework tasks on time in a row.', 'Üst üste 10 ödevi zamanında tamamla.', 'comet', 'gold', r('homework_on_time_streak', 10)],
  ]),
  ...make(
    'skills',
    Object.entries(SKILL_NAMES).map(([skill, [en, tr, icon]]): Def => [
      `skills.${skill}`,
      en,
      tr,
      `Show your ${skill} work 3 times (evidence or reached goals).`,
      `${({ listening: 'Dinleme', reading: 'Okuma', vocabulary: 'Kelime', grammar: 'Dil bilgisi', writing: 'Yazma', speaking: 'Konuşma', phonics: 'Sesletim' } as Record<string, string>)[skill]} çalışmanı 3 kez göster (kanıt ya da ulaşılan hedef).`,
      icon,
      'silver',
      r('skill_activity', 3, { skill: skill as AchievementSkill }),
    ]),
  ),
  ...make('roles', [
    ['roles.assistant1', 'Class helper', 'Sınıf yardımcısı', 'Be the daily assistant for the first time.', 'İlk kez günün yardımcısı ol.', 'heartHands', 'bronze', r('assistant_day', 1)],
    ['roles.assistant5', 'Class helper', 'Sınıf yardımcısı', 'Be the daily assistant 5 times.', '5 kez günün yardımcısı ol.', 'heartHands', 'silver', r('assistant_day', 5)],
    ['roles.assistant10', 'Class helper', 'Sınıf yardımcısı', 'Be the daily assistant 10 times.', '10 kez günün yardımcısı ol.', 'crown', 'gold', r('assistant_day', 10)],
    ['roles.duties', 'Every job done', 'Bütün görevler tamam', 'Finish all assistant jobs on a day.', 'Bir günde yardımcı görevlerinin hepsini bitir.', 'check', 'bronze', r('assistant_all_duties', 1)],
    ['roles.duties5', 'Every job done', 'Bütün görevler tamam', 'Finish all assistant jobs on 5 days.', '5 günde yardımcı görevlerinin hepsini bitir.', 'star', 'silver', r('assistant_all_duties', 5)],
  ]),
  ...make('secret', [
    ['secret.earned', 'Secret star', 'Gizli yıldız', 'Be a Secret Student when the class earns it.', 'Sınıf kazandığında Gizli Öğrenci ol.', 'mask', 'bronze', r('secret_earned', 1)],
    ['secret.earned3', 'Secret star', 'Gizli yıldız', 'Be a Secret Student 3 times when the class earns it.', 'Sınıf kazandığında 3 kez Gizli Öğrenci ol.', 'stars', 'silver', r('secret_earned', 3)],
  ]),
  ...make('speakers', [
    ['speakers.first', 'First English point', 'İlk İngilizce puanı', 'Earn your first Super Speakers point.', 'İlk Süper Konuşmacı puanını kazan.', 'speech', 'bronze', r('speaker_points', 1)],
    ['speakers.p5', 'Super speaker', 'Süper konuşmacı', 'Earn 5 Super Speakers points.', '5 Süper Konuşmacı puanı kazan.', 'microphone', 'bronze', r('speaker_points', 5)],
    ['speakers.p10', 'Super speaker', 'Süper konuşmacı', 'Earn 10 Super Speakers points.', '10 Süper Konuşmacı puanı kazan.', 'microphone', 'silver', r('speaker_points', 10)],
    ['speakers.p25', 'Super speaker', 'Süper konuşmacı', 'Earn 25 Super Speakers points.', '25 Süper Konuşmacı puanı kazan.', 'trophy', 'gold', r('speaker_points', 25)],
  ]),
  ...make('teacher', [
    ['teacher.kind', 'Kind helper', 'Nazik yardımcı', 'Helped others kindly.', 'Başkalarına nazikçe yardım etti.', 'heart', 'none', null],
    ['teacher.listener', 'Great listener', 'Harika dinleyici', 'Listened really well.', 'Çok güzel dinledi.', 'headphones', 'none', null],
    ['teacher.brave', 'Brave speaker', 'Cesur konuşmacı', 'Spoke up bravely.', 'Cesurca konuştu.', 'speech', 'none', null],
    ['teacher.creative', 'Creative thinker', 'Yaratıcı düşünür', 'Had creative ideas.', 'Yaratıcı fikirleri vardı.', 'palette', 'none', null],
    ['teacher.team', 'Team player', 'Takım oyuncusu', 'Worked well in a team.', 'Takımda güzel çalıştı.', 'handshake', 'none', null],
    ['teacher.effort', 'Super effort', 'Süper çaba', 'Tried really hard.', 'Çok çabaladı.', 'rocket', 'none', null],
    ['teacher.tidy', 'Tidy worker', 'Düzenli çalışan', 'Kept work and desk tidy.', 'Çalışmasını ve masasını düzenli tuttu.', 'brush', 'none', null],
    ['teacher.curious', 'Curious question', 'Meraklı soru', 'Asked a curious question.', 'Meraklı bir soru sordu.', 'magnifier', 'none', null],
    ['teacher.friend', 'Good friend', 'İyi arkadaş', 'Was a good friend.', 'İyi bir arkadaştı.', 'smile', 'none', null],
    ['teacher.neverGiveUp', 'Never gives up', 'Asla pes etmez', 'Kept going when it was hard.', 'Zor olduğunda devam etti.', 'mountain', 'none', null],
    ['teacher.readingStar', 'Reading star', 'Okuma yıldızı', 'Read wonderfully.', 'Harika okudu.', 'books', 'none', null],
    ['teacher.wordWizard', 'Word wizard', 'Kelime büyücüsü', 'Used new words like magic.', 'Yeni kelimeleri sihir gibi kullandı.', 'wand', 'none', null],
    ['teacher.pronunciation', 'Great pronunciation', 'Harika telaffuz', 'Said the words beautifully.', 'Kelimeleri çok güzel söyledi.', 'musicNotes', 'none', null],
    ['teacher.handwriting', 'Neat handwriting', 'Düzgün yazı', 'Wrote neatly.', 'Düzgün yazdı.', 'pencil', 'none', null],
    ['teacher.problemSolver', 'Problem solver', 'Sorun çözücü', 'Solved a problem.', 'Bir sorunu çözdü.', 'key', 'none', null],
    ['teacher.goodSport', 'Good sport', 'İyi oyuncu', 'Played fair and kind.', 'Adil ve nazik oynadı.', 'ball', 'none', null],
    ['teacher.leader', 'Leader', 'Lider', 'Led the way well.', 'Güzel liderlik etti.', 'flag', 'none', null],
    ['teacher.patient', 'Patient', 'Sabırlı', 'Waited patiently.', 'Sabırla bekledi.', 'turtle', 'none', null],
    ['teacher.polite', 'Polite', 'Kibar', 'Was polite to everyone.', 'Herkese kibar davrandı.', 'flower', 'none', null],
    ['teacher.improvement', 'Big improvement', 'Büyük gelişme', 'Made a big improvement.', 'Büyük bir gelişme gösterdi.', 'seedling', 'none', null],
    ['teacher.helper', 'Helping hand', 'Yardım eli', 'Helped the teacher.', 'Öğretmene yardım etti.', 'thumbsUp', 'none', null],
    ['teacher.sunshine', 'Ray of sunshine', 'Güneş ışığı', 'Made the class smile.', 'Sınıfı gülümsetti.', 'sun', 'none', null],
  ]),
];

/** Deterministic id of a default definition (the server seeds them once with these ids). */
export const defaultAchievementId = (key: string) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  const idx = DEFAULT_ACHIEVEMENTS.findIndex((d) => d.key === key);
  return `00000000-0000-7000-8a00-${hex}${String(idx < 0 ? 0 : idx).padStart(4, '0')}`;
};

// ---------------------------------------------------------------- private levels (D-121)
/** Points needed for each level (Explorer 1 at 0 points … Explorer 10). Personal only, never ranked. */
export const LEVEL_THRESHOLDS = [0, 3, 7, 12, 18, 25, 33, 42, 52, 63] as const;
export const LEVEL_NAMES: readonly LocalizedTextValue[] = [
  { en: 'Explorer 1: Curious seed', tr: 'Kaşif 1: Meraklı tohum' },
  { en: 'Explorer 2: Little sprout', tr: 'Kaşif 2: Küçük filiz' },
  { en: 'Explorer 3: Path finder', tr: 'Kaşif 3: Yol bulucu' },
  { en: 'Explorer 4: Map reader', tr: 'Kaşif 4: Harita okuyucu' },
  { en: 'Explorer 5: Bridge builder', tr: 'Kaşif 5: Köprü kurucu' },
  { en: 'Explorer 6: Mountain climber', tr: 'Kaşif 6: Dağ tırmanıcısı' },
  { en: 'Explorer 7: Sky sailor', tr: 'Kaşif 7: Gökyüzü denizcisi' },
  { en: 'Explorer 8: Star gazer', tr: 'Kaşif 8: Yıldız gözlemcisi' },
  { en: 'Explorer 9: Planet hopper', tr: 'Kaşif 9: Gezegen gezgini' },
  { en: 'Explorer 10: Galaxy guide', tr: 'Kaşif 10: Galaksi rehberi' },
];

export function levelFor(points: number): { level: number; name: LocalizedTextValue; points: number; nextAt: number | null } {
  let i = 0;
  while (i + 1 < LEVEL_THRESHOLDS.length && points >= LEVEL_THRESHOLDS[i + 1]!) i++;
  return { level: i + 1, name: LEVEL_NAMES[i]!, points, nextAt: LEVEL_THRESHOLDS[i + 1] ?? null };
}

/** A manual award can be undone from the classroom for this long; later it is a PIN-gated revoke. */
export const CLASSROOM_UNDO_MS = 10 * 60_000;
