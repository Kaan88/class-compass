/**
 * "This browser has been used as a classroom display" (S31, D-208): remembered on the device when a
 * teacher enters classroom mode on it. The sign-in page reads it to keep Google sign-in away from a
 * computer the whole class can reach, because a Google sign-in leaves that Google account open in the
 * browser. It is a hint for the sign-in page only, holds nothing about any person, and is never sent
 * to the server. Storage may be blocked: then the device simply counts as not marked.
 */
const KEY = 'cc.classroomDevice';

export function markClassroomDevice(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked: nothing to remember */
  }
}

export function isClassroomDevice(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
