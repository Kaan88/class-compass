/**
 * Avatars (S13c, D-124): a core piece (always on). The teacher page; cards everywhere read the avatar directory.
 * S24 (D-184): the "Avatar pictures" page of the "Today" group (students' own pictures to check), shown
 * while the school switch `media.avatarPictures` is on, with the number to check on its tile; the page
 * and its strings are loaded only when it is opened.
 */
import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { teacherPictureCount } from '../../../shared/contracts/avatars.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { SENSITIVE } from '../../lib/queryClient.ts';
import { IconAvatar, IconImage } from '../../ui/icons.tsx';
import { defineClientModule } from '../types.ts';
import { AvatarsPage } from './AvatarsPage.tsx';

const PicturesPage = lazy(() => import('./AvatarPicturesPage.tsx'));

function AvatarPicturesRoute() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <main className="cc-page">
          <p className="cc-muted" role="status">
            {t('common.loading')}
          </p>
        </main>
      }
    >
      <PicturesPage />
    </Suspense>
  );
}

/** Same key as `PICTURE_COUNT_KEY` in PictureReview.tsx (not imported: that file is the lazy page's). */
const COUNT_KEY = [SENSITIVE, 'teacher', 'avatarPictures', 'count'] as const;

/** The number of pictures to check, polled every minute (a background poll, PIN-7). */
function usePicturesToCheck(): number | null {
  const q = useQuery({
    queryKey: COUNT_KEY,
    queryFn: () => call(teacherPictureCount, {}),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
  });
  return q.data?.enabled ? q.data.toCheck : null;
}

export const avatarsClientManifest = defineClientModule({
  key: 'avatars',
  policyKey: null,
  i18nNamespace: 'avatar',
  teacherPages: [
    {
      key: 'avatars',
      path: 'avatars',
      labelKey: 'teacher.avatars',
      Icon: IconAvatar,
      order: 140,
      group: 'setup',
      setupTab: 'classes',
      Component: AvatarsPage,
    },
    {
      key: 'avatarPictures',
      path: 'avatar-pictures',
      labelKey: 'teacher.avatarPictures',
      Icon: IconImage,
      order: 127,
      group: 'today',
      media: 'media.avatarPictures',
      useBadge: usePicturesToCheck,
      Component: AvatarPicturesRoute,
    },
  ],
});
