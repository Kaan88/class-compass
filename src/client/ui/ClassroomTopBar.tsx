/**
 * Classroom top bar (S13a, owner feedback 2026-11-07): the class name + subject on the left (always,
 * LES-4), the quote-of-the-day slot in the centre, the day, date and time + the weather slot on the
 * right; then the save state, a "Display" button and Teacher area. The quote and weather slots are
 * filled by S13b (`registerTopBarSlot`); while nothing is registered they are not rendered at all.
 *
 * Usability pass (D-139): the device settings (class language when the class has two, Compact /
 * Normal / Large, sounds on this device) are in one popover behind "Display", so the bar fits on one
 * row also in Turkish and on 1280×720 displays.
 *
 * Sound (S14a, D-145): while the browser still waits for a tap before it plays sound (or this
 * device's sounds are off) the bar shows a chip "Sound is off · Turn sound on"; tapping it is the
 * unlocking gesture (and turns this device's sounds on). The Display popover has "Test sound" and a
 * Sound check block (status, audio engine, volume, switches, last sound, Copy diagnostics).
 *
 * Classroom board (S14b, D-148): while a lesson board is on screen the Display popover offers
 * "Customise layout"; it asks for the PIN (`PinDialog`) and then opens the board's layout editor.
 * Below 64rem the board is one column and the button explains that a wider screen is needed.
 */
import { useState, type ReactNode } from 'react';
import { Dialog, DialogTrigger, Popover } from 'react-aria-components';
import { pickText } from '../../shared/i18n/index.ts';
import { classLocales } from '../../shared/classLanguage.ts';
import { copyText, showManualCopy } from '../lib/clipboard.ts';
import { DENSITIES, type Density } from '../lib/classroomPrefs.ts';
import { getDisplay, setDisplay } from '../lib/display.ts';
import { useI18n } from '../lib/i18n.tsx';
import { topBarSlots, type TopBarSlotKey } from '../modules/classroomHooks.ts';
import type { ClassroomContext } from '../modules/types.ts';
import { playEvent, SELF_UNLOCK_ATTR, sounds, useSoundStatus, type SoundSnapshot, type SoundStatus } from '../themes/index.tsx';
import { Button } from './Button.tsx';
import { FrameOverlay } from './Frame.tsx';
import { lockNow } from '../lib/session.ts';
import { isWideEnough, setLayoutEditing, useWideEnough } from '../modules/lessons/board/layoutClient.ts';
import { IconCopy, IconLayout, IconSettings, IconSound, IconSoundOff } from './icons.tsx';
import { PinDialog } from './PinDialog.tsx';

const SIZE_KEYS = { compact: 'classroom.size.compact', normal: 'classroom.size.normal', large: 'classroom.size.large' } as const;

function Slot({ slot, context }: { slot: TopBarSlotKey; context: ClassroomContext }) {
  const { locale } = useI18n();
  const list = topBarSlots(slot);
  if (!list.length) return null;
  return (
    <div className={`cc-topbar__slot cc-topbar__slot--${slot}`} data-testid={`topbar-${slot}`}>
      {list.map(({ key, Component }) => (
        <Component key={key} context={context} locale={locale} />
      ))}
    </div>
  );
}

const ENGINE_KEYS = {
  none: 'sound.engine.none',
  running: 'sound.engine.running',
  suspended: 'sound.engine.suspended',
  interrupted: 'sound.engine.interrupted',
  closed: 'sound.engine.closed',
} as const;
const engineKey = (state: string) => ENGINE_KEYS[state as keyof typeof ENGINE_KEYS] ?? ENGINE_KEYS.suspended;

/** Turns sound on from a tap: this device's switch (when it was off), the browser unlock, a test cue. */
function turnSoundOn() {
  if (!getDisplay().deviceSounds) setDisplay({ deviceSounds: true });
  sounds.unlock();
  playEvent('soundTest');
}

/**
 * "Sound is off · Turn sound on": shown only while a tap (or this device's switch) would bring sound
 * back. The page-wide unlock listener leaves this chip alone (`data-unlocks-sound`), so its press
 * completes: the press unlocks audio and plays the test cue as confirmation.
 */
function SoundChip({ status }: { status: SoundStatus }) {
  const { t } = useI18n();
  if (status !== 'locked' && status !== 'mutedDevice') return null;
  return (
    <Button className="cc-sound-chip" data-testid="sound-chip" data-status={status} {...{ [SELF_UNLOCK_ATTR]: '' }} onPress={turnSoundOn}>
      <IconSoundOff />
      <span className="cc-sound-chip__state">{t('sound.chip.off')}</span>
      <span className="cc-sound-chip__action">{t('sound.chip.turnOn')}</span>
    </Button>
  );
}

/** Plain text for "Copy diagnostics": no names, no class data, only how sound is set up here. */
export function soundDiagnostics(status: SoundStatus, snap: SoundSnapshot, now: number): string {
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { audioSession?: { type?: string } });
  const last = snap.last ? `${snap.last.event ?? '-'} at ${new Date(snap.last.at).toISOString()} (${snap.last.contextState})` : '-';
  return [
    'Class Compass sound check',
    `time: ${new Date(now).toISOString()}`,
    `status: ${status}`,
    `audio: ${snap.audio}`,
    `context: ${snap.contextState}`,
    `sampleRate: ${snap.sampleRate ?? '-'}`,
    `classSounds: ${snap.switches.classSounds ? 'on' : 'off'}`,
    `deviceSounds: ${snap.switches.deviceSounds ? 'on' : 'off'}`,
    `volume: ${snap.switches.volume}`,
    `last: ${last}`,
    `speech: ${typeof window !== 'undefined' && 'speechSynthesis' in window ? 'yes' : 'no'}`,
    `audioSession: ${nav?.audioSession?.type ?? '-'}`,
    `userAgent: ${nav?.userAgent ?? '-'}`,
  ].join('\n');
}

/** The Sound check block of the Display popover (S14a, D-145). */
function SoundCheck({ status, snapshot }: { status: SoundStatus; snapshot: SoundSnapshot }) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const onOff = (v: boolean) => t(v ? 'common.on' : 'common.off');
  const last = snapshot.last;
  const lastName = !last ? '' : last.event === 'clip' ? t('sound.check.clip') : last.event ? t(`sound.${last.event}`) : '';
  const lastTime = last ? new Date(last.at).toLocaleTimeString(locale === 'tr' ? 'tr-TR' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const copy = async () => {
    const text = soundDiagnostics(status, snapshot, Date.now());
    if (await copyText(text)) setCopied(true);
    else showManualCopy({ title: t('sound.check.copy'), label: t('sound.check.title'), text });
  };
  return (
    <section className="cc-stack cc-popover__group cc-sound-check" aria-labelledby="cc-sound-check" data-testid="sound-check">
      <span className="cc-field__label" id="cc-sound-check">
        {t('sound.check.title')}
      </span>
      <p className="cc-sound-check__status" data-testid="sound-status" data-status={status}>
        {status === 'running' ? <IconSound /> : <IconSoundOff />}
        <span>{t(`sound.status.${status}`)}</span>
      </p>
      <dl className="cc-sound-check__facts">
        <dt>{t('sound.check.engine')}</dt>
        <dd data-testid="sound-engine">{t(engineKey(snapshot.contextState))}</dd>
        <dt>{t('sound.check.classSwitch')}</dt>
        <dd>{onOff(snapshot.switches.classSounds)}</dd>
        <dt>{t('classroom.sounds')}</dt>
        <dd>{onOff(snapshot.switches.deviceSounds)}</dd>
        <dt>{t('sound.check.volume')}</dt>
        <dd>{snapshot.switches.volume}</dd>
        <dt>{t('sound.check.last')}</dt>
        <dd data-testid="sound-last">{last ? t('sound.check.lastValue', { name: lastName, time: lastTime }) : t('sound.check.lastNone')}</dd>
      </dl>
      <div className="cc-row cc-sound-check__actions">
        <Button data-testid="sound-test" onPress={turnSoundOn}>
          <IconSound />
          {t('sound.test')}
        </Button>
        <Button onPress={() => void copy()}>
          <IconCopy />
          {t('sound.check.copy')}
        </Button>
      </div>
      <p className="cc-muted cc-sound-check__hint" aria-live="polite">
        {copied ? t('sound.check.copied') : t('sound.check.hint')}
      </p>
    </section>
  );
}

export function ClassroomTopBar({
  context,
  dayLabel,
  dateLabel,
  timeLabel,
  density,
  onDensity,
  onLocale,
  settings,
  tools,
  canCustomise = false,
}: {
  context: (ClassroomContext & { mainLanguage: 'en' | 'tr'; secondLanguageEnabled: boolean }) | null;
  dayLabel: string;
  dateLabel: string;
  timeLabel: string;
  density: Density;
  onDensity: (d: Density) => void;
  onLocale: (l: 'en' | 'tr') => void;
  /** More device settings shown in the Display popover (the sounds switch). */
  settings?: ReactNode;
  tools: ReactNode;
  /** A lesson board is on screen: offer "Customise layout" (S14b). */
  canCustomise?: boolean;
}) {
  const { t, locale } = useI18n();
  const langs = context ? classLocales(context) : [];
  const sound = useSoundStatus();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const wide = useWideEnough();
  /**
   * The PIN was accepted: open the editor only where it can show (a lesson board of this class, a wide
   * enough window); otherwise lock again at once, so the unlock never outlives the editor (PIN-1). If the
   * board goes away in the same moment, layoutClient relocks when no editor appears.
   */
  const onUnlocked = () => {
    if (context && canCustomise && isWideEnough()) setLayoutEditing(context.id);
    else void lockNow().catch(() => undefined);
  };
  return (
    <header className="cc-topbar cc-classroom-bar" aria-label={t('classroom.activeClass')}>
      {/* Theme frame (S17a, D-166): decorative, outside the bar's content. */}
      <FrameOverlay surface="topBar" />
      <div className="cc-classroom-bar__class">
        {context ? (
          <>
            <span className="cc-classroom-bar__name" data-testid="class-banner-class">
              {context.className}
            </span>
            <span className="cc-classroom-bar__subject" data-testid="class-banner-subject">
              {pickText(context.subjectName, locale)}
            </span>
          </>
        ) : (
          <span className="cc-classroom-bar__name">{t('app.name')}</span>
        )}
      </div>
      {context ? <Slot slot="quote" context={context} /> : null}
      {context ? (
        <div className="cc-classroom-bar__when">
          <time className="cc-classroom-bar__date" data-testid="topbar-date">
            <span>{dayLabel}</span> <span>{dateLabel}</span>
          </time>
          <span className="cc-classroom-bar__time" data-testid="topbar-time">
            {timeLabel}
          </span>
          <Slot slot="weather" context={context} />
        </div>
      ) : null}
      <div className="cc-classroom-bar__tools">
        <SoundChip status={sound.status} />
        <DialogTrigger isOpen={settingsOpen} onOpenChange={setSettingsOpen}>
          <Button data-testid="classroom-settings">
            <IconSettings />
            {t('classroom.displaySettings')}
          </Button>
          <Popover placement="bottom end" className="cc-popover" data-testid="classroom-settings-popover">
            <Dialog className="cc-popover__body" aria-label={t('classroom.displaySettings')}>
              {langs.length > 1 ? (
                <div className="cc-stack cc-popover__group">
                  <span className="cc-field__label" id="cc-settings-lang">
                    {t('classroom.language')}
                  </span>
                  <div className="cc-row cc-segmented" role="group" aria-labelledby="cc-settings-lang" data-testid="class-language-switch">
                    {langs.map((l) => (
                      <Button key={l} size="small" aria-pressed={l === locale} onPress={() => onLocale(l)} lang={l}>
                        {t(l === 'en' ? 'language.en' : 'language.tr')}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="cc-stack cc-popover__group">
                <span className="cc-field__label" id="cc-settings-size">
                  {t('classroom.size')}
                </span>
                <div className="cc-row cc-segmented" role="group" aria-labelledby="cc-settings-size" data-testid="density-control">
                  {DENSITIES.map((d) => (
                    <Button key={d} size="small" aria-pressed={d === density} onPress={() => onDensity(d)}>
                      {t(SIZE_KEYS[d])}
                    </Button>
                  ))}
                </div>
              </div>
              {settings}
              {canCustomise ? (
                <div className="cc-stack cc-popover__group">
                  <Button
                    data-testid="customise-layout"
                    isDisabled={!wide}
                    onPress={() => {
                      setSettingsOpen(false);
                      setPinOpen(true);
                    }}
                  >
                    <IconLayout />
                    {t('board.customise')}
                  </Button>
                  <p className="cc-muted cc-popover__hint">{wide ? t('board.customiseHint') : t('board.customiseNarrow')}</p>
                </div>
              ) : null}
              <SoundCheck status={sound.status} snapshot={sound.snapshot} />
            </Dialog>
          </Popover>
        </DialogTrigger>
        {tools}
      </div>
      {pinOpen ? <PinDialog isOpen onOpenChange={setPinOpen} title={t('board.customise')} hint={t('board.pinHint')} onUnlocked={onUnlocked} /> : null}
    </header>
  );
}
