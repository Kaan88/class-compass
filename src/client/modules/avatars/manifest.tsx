/** Avatars (S13c, D-124): a core piece (always on). The teacher page; cards everywhere read the avatar directory. */
import { IconUser } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { AvatarsPage } from './AvatarsPage.tsx';

export const avatarsClientManifest = defineClientModule({
  key: 'avatars',
  policyKey: null,
  i18nNamespace: 'avatar',
  teacherPages: [{ key: 'avatars', path: 'avatars', labelKey: 'teacher.avatars', Icon: IconUser, order: 140, Component: AvatarsPage }],
});
