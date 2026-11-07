/**
 * English UI strings (default language). Turkish lives in tr.ts and must provide every key
 * (enforced by the type checker). Use {name} placeholders; plurals via `_one` / `_other` keys.
 * Teacher-editable labels (counter names, responsibilities…) are data, not dictionary entries.
 */
export const en = {
  'app.name': 'Class Compass',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.undo': 'Undo',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong',
  'save.saving': 'Saving…',
  'save.saved': 'Saved',
  'save.offline_one': 'Offline – {count} change waiting',
  'save.offline_other': 'Offline – {count} changes waiting',
  'save.error': 'Not saved – needs attention',
  'auth.signIn': 'Sign in',
  'auth.signOut': 'Sign out',
  'auth.login': 'Username',
  'auth.password': 'Password',
  'auth.incorrect': 'Incorrect sign-in details',
  'auth.tooMany': 'Too many attempts. Please wait and try again.',
  'pin.title': 'Teacher area locked',
  'pin.enter': 'Enter your PIN',
  'pin.unlock': 'Unlock',
  'pin.wrong': 'Wrong PIN',
  'pin.lockedOut': 'Too many wrong PINs. Please wait.',
  'pin.visibleOnDisplay': 'Visible on the classroom display',
  'pin.lockNow': 'Lock',
  'language.label': 'Language',
  'language.en': 'English',
  'language.tr': 'Türkçe',
  'home.welcome': 'Welcome, {name}',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
