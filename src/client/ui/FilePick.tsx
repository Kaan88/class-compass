/**
 * A big, translated "choose a file" button (S13 usability; shared since S21, every file picker uses it).
 * The browser's own file input shows its text in the browser's language ("Choose File · No file
 * chosen") and looks like plain text, so nobody sees that it opens a picker. Here the input is visually
 * hidden and its <label> is drawn as a big button: tapping the label opens the picker natively, the
 * input keeps the label as its accessible name and stays in the tab order (its focus ring is drawn on
 * the button). Under it, a translated line says what is chosen.
 */
import type { ReactNode, Ref } from 'react';
import { buttonClass } from './Button.tsx';

export function FilePick({
  id,
  label,
  icon,
  accept,
  multiple = false,
  capture,
  status,
  testId,
  inputRef,
  onFiles,
}: {
  id: string;
  /** Says what to choose ("Choose a theme file (.json)"); it is the button text and the input's name. */
  label: string;
  icon: ReactNode;
  accept: string;
  multiple?: boolean;
  capture?: 'environment' | 'user';
  /** Translated "what is chosen" line; omitted when the chosen files are listed elsewhere. */
  status?: string;
  testId?: string;
  inputRef?: Ref<HTMLInputElement>;
  onFiles: (files: File[]) => void;
}) {
  return (
    <div className="cc-field cc-file-pick">
      <input
        id={id}
        ref={inputRef}
        className="cc-visually-hidden cc-file-pick__input"
        type="file"
        multiple={multiple}
        accept={accept}
        capture={capture}
        data-testid={testId}
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
