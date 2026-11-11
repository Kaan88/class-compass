/**
 * The teacher's "Avatar pictures" page (S24, D-184): a "Today" page of the teacher menu, loaded only
 * when opened (with its area dictionary and stylesheet). Pictures of the students in the teacher's
 * classes: "To check" and "In use".
 */
import '../../../shared/i18n/areas/avatarPictures.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { PictureReview } from './PictureReview.tsx';

export default function AvatarPicturesPage() {
  const { t } = useI18n();
  return (
    <main className="cc-page cc-stack" data-testid="avatar-pictures-page">
      <h1 className="cc-h1">{t('avatarPictures.title')}</h1>
      <p className="cc-muted">{t('avatarPictures.intro')}</p>
      <p className="cc-muted">{t('avatarPictures.rules')}</p>
      <PictureReview scope="teacher" />
    </main>
  );
}
