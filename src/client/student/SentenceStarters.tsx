/**
 * Sentence starter chips (S14d, D-152) above a text box on the student page. Tapping a chip puts the
 * starter in the box and selects its blank (`___`), so the child types straight over it. When the box
 * already has the child's own words, "Replace your words?" asks first, in the page (never a browser
 * dialog); after "No, keep my words" the focus goes back to the chip that asked. Chips show the
 * blank as "…" so a screen reader does not read underscores.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { blankRange, isUnfinishedStarter } from '../../shared/text/starters.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Button } from '../ui/Button.tsx';
import { InlineConfirm } from '../ui/InlineConfirm.tsx';

/** The chip's words: the blank as "…" (a full stop right after it is dropped: "I like …"). */
export const chipText = (starter: string) => starter.replace(/_{2,}\.?/gu, '…');

export function SentenceStarters({
  starters,
  value,
  onChange,
  target,
}: {
  starters: readonly string[];
  value: string;
  onChange: (text: string) => void;
  /** The text box the starter goes into. */
  target: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useI18n();
  const [asking, setAsking] = useState<string | null>(null);
  const select = useRef<string | null>(null);
  const chips = useRef<HTMLDivElement>(null);
  /** The chip to focus again after "No" (its index): the question and its focused button are gone. */
  const returnTo = useRef<number | null>(null);
  useEffect(() => {
    if (asking !== null || returnTo.current === null) return;
    const i = returnTo.current;
    returnTo.current = null;
    chips.current?.querySelector<HTMLButtonElement>(`[data-starter="${i}"]`)?.focus();
  }, [asking]);
  // After the box shows the starter: focus it and select the blank.
  useEffect(() => {
    const el = target.current;
    if (select.current === null || !el || el.value !== select.current) return;
    select.current = null;
    el.focus();
    const r = blankRange(el.value);
    if (r) el.setSelectionRange(r.start, r.end);
    else el.setSelectionRange(el.value.length, el.value.length);
  });
  if (!starters.length) return null;
  const put = (s: string) => {
    select.current = s;
    setAsking(null);
    onChange(s);
  };
  const keep = () => {
    returnTo.current = asking === null ? null : starters.indexOf(asking);
    setAsking(null);
  };
  const tap = (s: string) => {
    // Empty, or still only a starter: nothing of the child's own would be lost.
    if (!value.trim() || isUnfinishedStarter(value, starters)) put(s);
    else setAsking(s);
  };
  return (
    <div className="cc-stack cc-starters">
      <div ref={chips} className="cc-starters__chips" role="group" aria-label={t('starters.title')} data-testid="sentence-starters">
        <span className="cc-starters__title" aria-hidden="true">
          {t('starters.title')}
        </span>
        {starters.map((s, i) => (
          <Button key={s} size="small" className="cc-starters__chip" onPress={() => tap(s)} data-starter={i}>
            {chipText(s)}
          </Button>
        ))}
      </div>
      {asking !== null ? (
        <InlineConfirm message={t('starters.replace')} confirmLabel={t('starters.replaceYes')} cancelLabel={t('starters.replaceNo')} onConfirm={() => put(asking)} onCancel={keep} />
      ) : null}
    </div>
  );
}
