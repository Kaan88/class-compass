/**
 * A big, translated "choose a file" button for evidence (S13 usability). The browser's own file input
 * shows its text in the browser's language ("Choose Files · No file chosen") and looks like a text
 * field, so it is visually hidden and its <label> is drawn as a big button: tapping the label opens
 * the picker natively, the input keeps the label as its accessible name and stays in the tab order
 * (its focus ring is drawn on the button). Under it, a translated line says what is chosen.
 */
import type { ReactNode } from 'react';
import { buttonClass } from '../../ui/Button.tsx';

export function FilePick({
  id,
  label,
  icon,
  accept,
  multiple = false,
  capture,
  status,
  onFiles,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  accept: string;
  multiple?: boolean;
  capture?: 'environment' | 'user';
  /** Translated "what is chosen" line; omitted when the chosen files are listed elsewhere. */
  status?: string;
  onFiles: (files: File[]) => void;
}) {
  return (
    <div className="cc-field cc-file-pick">
      <input
        id={id}
        className="cc-visually-hidden cc-file-pick__input"
        type="file"
        multiple={multiple}
        accept={accept}
        capture={capture}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          onFiles(files);
        }}
      />
      <label htmlFor={id} className={buttonClass('secondary', 'big', 'cc-file-pick__button')}>
        {icon}
        <span>{label}</span>
      </label>
      {status ? (
        <p className="cc-muted cc-file-pick__status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </div>
  );
}
