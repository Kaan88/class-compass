/**
 * Admin → Modules → Photos and media: students' own avatar pictures (S24, D-184). The same check as
 * the teachers' page (an administrator may decide for any student), what backups keep, and "Delete all
 * uploaded pictures" with a typed confirmation (audited with counts). Loaded only with the tab.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import '../../../shared/i18n/areas/avatarPictures.ts';
import { DELETE_ALL_PICTURES_CONFIRM } from '../../../shared/avatarPictures.ts';
import * as Av from '../../../shared/contracts/avatars.ts';
import { call } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { showToast } from '../../lib/toast.ts';
import { AVATARS_KEY } from '../../avatars/AvatarDirectory.tsx';
import { Button } from '../../ui/Button.tsx';
import { ConfirmDestructive } from '../../ui/Dialog.tsx';
import { IconTrash } from '../../ui/icons.tsx';
import { PictureReview, picturesKey } from './PictureReview.tsx';

export default function AvatarPicturesAdmin() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <section className="cc-card cc-stack" aria-labelledby="avatar-pictures-admin" data-testid="admin-avatar-pictures">
      <h2 id="avatar-pictures-admin" className="cc-h2">
        {t('avatarPictures.admin.title')}
      </h2>
      <p className="cc-muted">{t('avatarPictures.rules')}</p>
      <p className="cc-muted">{t('avatarPictures.admin.backups')}</p>
      <PictureReview scope="admin" />
      <div>
        <Button variant="danger" onPress={() => setOpen(true)} data-testid="pictures-delete-all">
          <IconTrash />
          {t('avatarPictures.admin.deleteAll')}
        </Button>
      </div>
      <ConfirmDestructive
        isOpen={open}
        onOpenChange={setOpen}
        title={t('avatarPictures.admin.deleteAll')}
        description={t('avatarPictures.admin.deleteAllExplain', { word: DELETE_ALL_PICTURES_CONFIRM })}
        confirmText={DELETE_ALL_PICTURES_CONFIRM}
        actionLabel={t('avatarPictures.admin.deleteAll')}
        onConfirm={async () => {
          const r = await call(Av.adminDeleteAllPictures, { confirm: DELETE_ALL_PICTURES_CONFIRM });
          showToast({ message: t('avatarPictures.admin.deletedAll', r), kind: 'success' });
          void qc.invalidateQueries({ queryKey: picturesKey('admin') });
          void qc.invalidateQueries({ queryKey: AVATARS_KEY });
        }}
      />
    </section>
  );
}
