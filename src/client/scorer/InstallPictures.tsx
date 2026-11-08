/**
 * Install instructions with pictures (S12, SSP-4): small drawings of the browser buttons to press, so
 * a teacher can follow them without reading much. Colours come from the theme tokens (CSS classes).
 */
import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n.tsx';

function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg className="cc-install-pic" viewBox="0 0 120 200" role="img" aria-label={label}>
      <rect className="cc-install-pic__body" x="4" y="4" width="112" height="192" rx="16" />
      <rect className="cc-install-pic__screen" x="12" y="20" width="96" height="160" rx="6" />
      {children}
    </svg>
  );
}

/** Safari's share button: a box with an arrow pointing up. */
const ShareGlyph = ({ x, y }: { x: number; y: number }) => (
  <g className="cc-install-pic__mark" transform={`translate(${x} ${y})`}>
    <path d="M-7 -2v11h14v-11" fill="none" strokeWidth="2.5" />
    <path d="M0 4v-14M-5 -6l5-5 5 5" fill="none" strokeWidth="2.5" />
  </g>
);

/** A plus inside a rounded square ("Add to Home Screen"). */
const AddGlyph = ({ x, y }: { x: number; y: number }) => (
  <g className="cc-install-pic__mark" transform={`translate(${x} ${y})`}>
    <rect x="-8" y="-8" width="16" height="16" rx="3" fill="none" strokeWidth="2.5" />
    <path d="M0 -4v8M-4 0h8" strokeWidth="2.5" />
  </g>
);

/** Chrome's three-dot menu. */
const MenuGlyph = ({ x, y }: { x: number; y: number }) => (
  <g className="cc-install-pic__dot" transform={`translate(${x} ${y})`}>
    <circle cy="-6" r="2.4" />
    <circle r="2.4" />
    <circle cy="6" r="2.4" />
  </g>
);

const Ring = ({ x, y }: { x: number; y: number }) => <circle className="cc-install-pic__ring" cx={x} cy={y} r="14" fill="none" strokeWidth="3" />;

function Step({ n, picture, text }: { n: number; picture: ReactNode; text: string }) {
  return (
    <li className="cc-install-step">
      {picture}
      <span>
        <strong>{n}.</strong> {text}
      </span>
    </li>
  );
}

export function IosSteps() {
  const { t } = useI18n();
  return (
    <ol className="cc-install-steps">
      <Step
        n={1}
        text={t('speakers.install.ios1')}
        picture={
          <Phone label={t('speakers.install.ios1')}>
            <rect className="cc-install-pic__bar" x="12" y="160" width="96" height="20" />
            <ShareGlyph x={60} y={171} />
            <Ring x={60} y={170} />
          </Phone>
        }
      />
      <Step
        n={2}
        text={t('speakers.install.ios2')}
        picture={
          <Phone label={t('speakers.install.ios2')}>
            <rect className="cc-install-pic__sheet" x="16" y="90" width="88" height="86" rx="6" />
            <rect className="cc-install-pic__line" x="24" y="104" width="50" height="6" rx="3" />
            <rect className="cc-install-pic__line" x="24" y="124" width="56" height="6" rx="3" />
            <AddGlyph x={88} y={147} />
            <rect className="cc-install-pic__line" x="24" y="144" width="48" height="6" rx="3" />
            <Ring x={88} y={147} />
          </Phone>
        }
      />
      <Step
        n={3}
        text={t('speakers.install.ios3')}
        picture={
          <Phone label={t('speakers.install.ios3')}>
            <rect className="cc-install-pic__app" x="44" y="70" width="32" height="32" rx="8" />
            <rect className="cc-install-pic__line" x="38" y="108" width="44" height="6" rx="3" />
            <Ring x={60} y={86} />
          </Phone>
        }
      />
    </ol>
  );
}

export function AndroidSteps() {
  const { t } = useI18n();
  return (
    <ol className="cc-install-steps">
      <Step
        n={1}
        text={t('speakers.install.android1')}
        picture={
          <Phone label={t('speakers.install.android1')}>
            <rect className="cc-install-pic__bar" x="12" y="20" width="96" height="20" />
            <MenuGlyph x={98} y={30} />
            <Ring x={98} y={30} />
          </Phone>
        }
      />
      <Step
        n={2}
        text={t('speakers.install.android2')}
        picture={
          <Phone label={t('speakers.install.android2')}>
            <rect className="cc-install-pic__sheet" x="44" y="40" width="60" height="80" rx="4" />
            <rect className="cc-install-pic__line" x="50" y="52" width="40" height="6" rx="3" />
            <rect className="cc-install-pic__line" x="50" y="70" width="44" height="6" rx="3" />
            <rect className="cc-install-pic__line" x="50" y="88" width="36" height="6" rx="3" />
            <Ring x={72} y={73} />
          </Phone>
        }
      />
      <Step
        n={3}
        text={t('speakers.install.android3')}
        picture={
          <Phone label={t('speakers.install.android3')}>
            <rect className="cc-install-pic__app" x="44" y="70" width="32" height="32" rx="8" />
            <rect className="cc-install-pic__line" x="38" y="108" width="44" height="6" rx="3" />
            <Ring x={60} y={86} />
          </Phone>
        }
      />
    </ol>
  );
}
