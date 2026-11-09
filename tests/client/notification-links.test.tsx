// @vitest-environment jsdom
/**
 * S14i polish (D-155): a notification's Open takes the teacher to the page with the student's class
 * (or class+subject) chosen and the student selected where the page has a natural selection: the
 * achievements dialog, the student's goals, the report's student; on class lists (avatars, student
 * links, the kind words notice) the student's row is marked and scrolled into view (`ui/linkedRow.ts`).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationItem } from '../../src/shared/contracts/notifications.ts';
import { deepLink } from '../../src/client/modules/notifications/NotificationsPage.tsx';
import { useLinkedRow } from '../../src/client/ui/linkedRow.ts';

afterEach(cleanup);

const item = (category: NotificationItem['category'], extra: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  category,
  student: { id: 'st1', fullName: 'Elif Demo' },
  context: { id: 'ctx1', classId: 'cls1', className: '3-A', subjectName: { en: 'English', tr: 'İngilizce' } },
  entity: 'goal',
  goalId: null,
  count: 1,
  localDate: '2026-11-09',
  createdAt: 0,
  updatedAt: 0,
  read: false,
  snippet: null,
  label: null,
  gone: false,
  ...extra,
});

describe('notification Open links (D-155)', () => {
  it('names the class or class+subject and the student for every page that has a selection', () => {
    expect(deepLink(item('achievementEarned'))).toEqual({ page: 'achievements', search: { contextId: 'ctx1', studentId: 'st1' } });
    expect(deepLink(item('avatarChanged'))).toEqual({ page: 'avatars', search: { classId: 'cls1', studentId: 'st1' } });
    expect(deepLink(item('linkNewDevice'))).toEqual({ page: 'student-links', search: { classId: 'cls1', studentId: 'st1' } });
    expect(deepLink(item('textBlocked'))).toEqual({ page: 'text-checks', search: { contextId: 'ctx1', studentId: 'st1' } });
    expect(deepLink(item('speakersPoints'))).toEqual({ page: 'reports', search: { contextId: 'ctx1', studentId: 'st1', view: 'achievementsSpeakers' } });
    expect(deepLink(item('goalCreated'))).toEqual({ page: 'goals', search: { contextId: 'ctx1', studentId: 'st1' } });
  });

  it('keeps the student without a class+subject, and opens nothing for a line that is gone', () => {
    expect(deepLink(item('avatarChanged', { context: null }))).toEqual({ page: 'avatars', search: { studentId: 'st1' } });
    expect(deepLink(item('goalCreated', { gone: true }))).toBeNull();
  });
});

function Rows({ linked }: { linked?: string }) {
  const row = useLinkedRow(linked);
  return (
    <ul>
      {['a', 'b', 'c'].map((id) => (
        <li key={id} data-testid={`row-${id}`} {...row(id)}>
          {id}
        </li>
      ))}
    </ul>
  );
}

describe('the linked student row (S14i)', () => {
  it('marks only the named student, with aria-current, and scrolls to it once', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { rerender } = render(<Rows linked="b" />);
    expect(screen.getByTestId('row-b').getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('row-b').getAttribute('data-linked')).toBe('true');
    expect(screen.getByTestId('row-a').hasAttribute('aria-current')).toBe(false);
    rerender(<Rows linked="b" />);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('marks nothing without a student', () => {
    render(<Rows />);
    expect(document.querySelector('[data-linked]')).toBeNull();
  });
});
