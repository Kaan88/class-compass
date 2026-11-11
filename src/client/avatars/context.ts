/**
 * Avatar directory (S13c item 11, D-124): the teacher app loads every avatar of the teacher's
 * classes once (`/api/classroom/avatars`, catalogue keys only) and every `<Avatar id=…>` looks the
 * student up here, so cards, the group screen, reveals and lists show the same avatar without one
 * request per card. The student page has no directory; it passes its own spec.
 */
import { createContext, useContext } from 'react';
import type { AvatarSpecValue } from '../../shared/avatars.ts';

export interface AvatarEntry {
  spec: AvatarSpecValue | null;
  fallback: 'generated' | 'initials';
  /** S24 (D-184): the student's own approved picture (classroom URL), when the school switch is on. */
  pictureUrl?: string | null;
}

export const AvatarDirectoryContext = createContext<ReadonlyMap<string, AvatarEntry> | null>(null);

export const useAvatarEntry = (studentId: string | undefined): AvatarEntry | undefined => {
  const dir = useContext(AvatarDirectoryContext);
  return studentId ? dir?.get(studentId) : undefined;
};
