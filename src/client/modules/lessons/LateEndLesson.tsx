/**
 * Filling in End Lesson for a lesson that ended by itself (S37, D-218; the owner: "it should ask for a
 * day to enter records, then close it"). Opened from the teacher home's notice and from the
 * `lessonAutoEnded` notification (`/teacher?fillIn=<lessonId>`), so it runs in the teacher area, behind
 * the PIN gate, never on the classroom board: nothing reaches a classroom display. The flow is the
 * normal End Lesson (`EndLessonFlow`) with that lesson's own state (`LessonStateOverride`), sent as the
 * normal 'lesson.end' command (the server's `lateEnd`); steps that can no longer be applied are shown
 * as not available. The window (until the end of the next school day) comes from the server; past it
 * the server answers LESSON_FILL_IN_CLOSED and this page says so.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as L from "../../../shared/contracts/lessons.ts";
import type { LessonSummary } from "../../../shared/contracts/lessons.ts";
import { call } from "../../lib/api.ts";
import { errorText } from "../../lib/errors.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { buttonClass } from "../../ui/Button.tsx";
import { Alert } from "../../ui/Feedback.tsx";
import {
  EndLessonFlow,
  LessonSummaryView,
  type EndDraft,
} from "./EndLesson.tsx";
import { LessonStateOverride, type LessonQueryData } from "./lessonClient.ts";

export const lessonFillInKey = (lessonId: string) =>
  ["sensitive", "lessonFillIn", lessonId] as const;

/** `onSaved`: the lesson was filled in (the caller refreshes its notices). */
export function LateEndLesson({
  lessonId,
  onClose,
  onSaved,
}: {
  lessonId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: lessonFillInKey(lessonId),
    queryFn: () => call(L.lessonFillIn, { lessonId }),
    retry: false,
    staleTime: Infinity,
  });
  const [draft, setDraft] = useState<EndDraft | null>(null);
  const [done, setDone] = useState<{ summary: LessonSummary | null } | null>(
    null,
  );
  const [queued, setQueued] = useState(false);
  const d = q.data;
  // Opened by `?fillIn=` (a link from the notice or a notification): focus goes to the flow's heading.
  const box = useRef<HTMLDivElement>(null);
  const showingFlow = Boolean(d) && !done && !queued;
  useLayoutEffect(() => {
    if (!showingFlow) return;
    const h = box.current?.querySelector<HTMLElement>("h2");
    if (!h) return;
    h.tabIndex = -1;
    h.focus();
  }, [showingFlow]);
  // The duties of the day are live commands on a running lesson: not offered here (the thanks is).
  const override = useMemo<LessonQueryData | null>(
    () =>
      d
        ? {
            etag: null,
            data: {
              ...d.state,
              assistant: d.state.assistant
                ? { ...d.state.assistant, responsibilities: [] }
                : null,
            },
          }
        : null,
    [d],
  );
  const back = (
    <div>
      <Link
        to="/teacher"
        search={{}}
        className={buttonClass("secondary")}
        onClick={onClose}
      >
        {t("lessonFillIn.back")}
      </Link>
    </div>
  );
  if (q.isError) {
    return (
      <section className="cc-card cc-stack" data-testid="lesson-fill-in-closed">
        <Alert>{errorText(t, q.error)}</Alert>
        {back}
      </section>
    );
  }
  if (!d || !override) return <p className="cc-muted">{t("common.loading")}</p>;
  if (done) {
    return (
      <LessonSummaryView
        lessonId={lessonId}
        timezone={d.timezone}
        initial={done.summary}
        onDone={onClose}
      />
    );
  }
  if (queued) {
    return (
      <section className="cc-card cc-stack" data-testid="lesson-fill-in-queued">
        <p role="status">{t("lesson.queuedEnd.offline")}</p>
        {back}
      </section>
    );
  }
  return (
    <div ref={box}>
      <LessonStateOverride.Provider value={override}>
        <EndLessonFlow
          context={{
            id: d.contextId,
            className: d.className,
            subjectName: d.subjectName,
          }}
          lesson={d.state.lesson}
          live={false}
          late={{
            notAvailable: d.notAvailable,
            endedAt: d.endedAt,
            until: d.fillInUntil,
            timezone: d.timezone,
          }}
          draft={draft}
          onDraft={(fn) => setDraft((x) => fn(x))}
          onCancel={onClose}
          onEnded={(summary) => {
            onSaved();
            setDone({ summary });
          }}
          onQueued={() => setQueued(true)}
        />
      </LessonStateOverride.Provider>
    </div>
  );
}
