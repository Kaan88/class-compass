/** Provides the avatar directory to the teacher app (mounted in the root layout for signed-in teachers). */
import { useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { classroomAvatars } from '../../shared/contracts/avatars.ts';
import { call } from '../lib/api.ts';
import { AvatarDirectoryContext, type AvatarEntry } from './context.ts';

export const AVATARS_KEY = ['classroom', 'avatars'] as const;

export function AvatarDirectoryProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const q = useQuery({ queryKey: AVATARS_KEY, queryFn: () => call(classroomAvatars, {}), enabled, staleTime: 30_000, refetchInterval: enabled ? 60_000 : false });
  const map = useMemo(() => {
    if (!q.data) return null;
    const fallback = new Map(q.data.classes.map((c) => [c.classId, c.fallback]));
    const m = new Map<string, AvatarEntry>();
    for (const s of q.data.students) {
      const prev = m.get(s.id);
      // A student in two of the teacher's classes: initials win if either class asks for them.
      const fb = prev?.fallback === 'initials' || fallback.get(s.classId) === 'initials' ? 'initials' : 'generated';
      m.set(s.id, { spec: s.spec, fallback: fb });
    }
    return m;
  }, [q.data]);
  return <AvatarDirectoryContext.Provider value={map}>{children}</AvatarDirectoryContext.Provider>;
}
