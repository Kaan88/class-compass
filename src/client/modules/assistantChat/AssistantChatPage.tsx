/**
 * The Assistant page (S19b, D-180): the teacher's chats with an AI model, inside the teacher area (PIN
 * gate), loaded only when opened. A list of chats (search, archive, rename, delete, continue), the
 * conversation with the answer streaming in, brief "looked at" lines for read tools, a card with Yes/No
 * for every change the model asks for (the change itself stays on the server), Copy on every answer
 * (drafts for parents are copied, never sent from the app), and the model picker limited to the
 * connections the teacher may use. Every query is `['sensitive', …]`; the texts carry real names, which
 * the server put back (the provider may have seen pseudonyms).
 *
 * S27d (D-196): answers are drawn as a safe Markdown subset (`ChatMarkdown`), a .json, .txt or .md file
 * up to 200 KB can be attached to a message (sent as text), and administrators use the same page on
 * Admin → Assistant (`area="admin"`: the admin route, intro and suggestions).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import "../../../shared/i18n/areas/aiConnections.ts";
import "../../../shared/i18n/areas/assistantChat.ts";
import { AI_FAILURES } from "../../../shared/aiConnections.ts";
import {
  ASSISTANT_ATTACHMENT_MAX_BYTES,
  ASSISTANT_MESSAGE_MAX,
  attachmentLanguage,
  utf8Bytes,
} from "../../../shared/assistantChat.ts";
import * as C from "../../../shared/contracts/assistantChat.ts";
import type {
  AssistantCallView,
  AssistantChangeLine,
  AssistantChatDetail,
  AssistantMessageView,
  AssistantRunEvent,
  AssistantStatus,
} from "../../../shared/contracts/assistantChat.ts";
import {
  formatDate,
  hasMessage,
  type MessageKey,
} from "../../../shared/i18n/index.ts";
import { call, urlFor } from "../../lib/api.ts";
import { copyText, showManualCopy } from "../../lib/clipboard.ts";
import { errorText } from "../../lib/errors.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { showToast } from "../../lib/toast.ts";
import { useRun } from "../../lib/useRun.ts";
import { Button, buttonClass } from "../../ui/Button.tsx";
import { Alert, EmptyState } from "../../ui/Feedback.tsx";
import { Select, TextArea, TextField, Toggle } from "../../ui/Fields.tsx";
import { FilePick } from "../../ui/FilePick.tsx";
import { InlineConfirmButton } from "../../ui/InlineConfirm.tsx";
import {
  IconArchive,
  IconBack,
  IconCheck,
  IconCopy,
  IconFile,
  IconPencil,
  IconPlus,
  IconStop,
  IconTrash,
  IconX,
} from "../../ui/icons.tsx";
import type { TeacherPageSearch } from "../types.ts";
import "./assistantChat.css";
import { ChatMarkdown, UserText } from "./ChatMarkdown.tsx";
import { ChatThemePreview } from "./ChatThemePreview.tsx";

const BASE = ["sensitive", "assistant-chat"] as const;
const STATUS_KEY = [...BASE, "status"] as const;
const LIST_KEY = [...BASE, "list"] as const;
const chatKey = (id: string) => [...BASE, "chat", id] as const;
const PAGE = "ai-assistant";

/** Where the page is shown: the teacher area (`/teacher/ai-assistant`) or the admin area (`/admin/ai-assistant`, S27d). */
export type AssistantArea = "teacher" | "admin";
const AreaContext = createContext<AssistantArea>("teacher");

/** A file waiting to be sent with the next message (S27d): text only, checked here and again on the server. */
interface Attachment {
  name: string;
  text: string;
  bytes: number;
}

/** Reads a chosen file as an attachment, or says why it cannot be attached. */
export async function readAttachment(
  file: File,
): Promise<
  | { ok: true; attachment: Attachment }
  | { ok: false; reason: "wrongType" | "tooBig" | "notText" }
> {
  if (!attachmentLanguage(file.name)) return { ok: false, reason: "wrongType" };
  if (file.size > ASSISTANT_ATTACHMENT_MAX_BYTES)
    return { ok: false, reason: "tooBig" };
  const text = await file.text();
  // A binary file renamed to .txt: NUL or replacement characters mean it is not text.
  if (/[\u0000\uFFFD]/u.test(text)) return { ok: false, reason: "notText" };
  const bytes = utf8Bytes(text);
  if (bytes > ASSISTANT_ATTACHMENT_MAX_BYTES) return { ok: false, reason: "tooBig" };
  return { ok: true, attachment: { name: file.name, text, bytes } };
}
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type T = ReturnType<typeof useI18n>["t"];

/** Why an answer failed, in words: a provider failure (D-179), a translated reason, or a generic line. */
/** A tool in words ("Class list", "New homework"); a tool the page does not know is "an unknown tool". */
export function toolLabel(t: T, tool: string): string {
  const key = `assistantChat.tool.${tool}`;
  return t(
    (hasMessage(key) ? key : "assistantChat.tool.unknown") as MessageKey,
  );
}

/** An argument's name on a card ("Title", "Due on"). */
export function argLabel(t: T, key: string): string {
  const k = `assistantChat.arg.${key}`;
  return t((hasMessage(k) ? k : "assistantChat.arg.other") as MessageKey);
}

/** One value on a card, in words: text exactly as it will be written, choices and switches translated. */
export function changeValue(t: T, l: AssistantChangeLine): string {
  if (l.kind === "flag")
    return l.value === "true"
      ? t("assistantChat.value.yes")
      : t("assistantChat.value.no");
  if (l.kind === "missing") return t("assistantChat.value.missing");
  if (l.kind === "option")
    return l.optionKey && hasMessage(l.optionKey)
      ? t(l.optionKey as MessageKey)
      : l.value;
  return l.value;
}

/** Scrolls an element into view (instantly when the teacher asked for reduced motion). */
function reveal(el: Element | null, block: ScrollLogicalPosition = "nearest") {
  if (!el || typeof el.scrollIntoView !== "function") return;
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block });
}

export function failureText(t: T, code: string | null): string {
  if (code && (AI_FAILURES as readonly string[]).includes(code))
    return t(`aiConn.failure.${code}` as MessageKey);
  if (code && hasMessage(`error.${code}`))
    return t(`error.${code}` as MessageKey);
  return t("common.error");
}

/**
 * Reads a run's events (Server-Sent Events over fetch, so the session cookie and a Stop through
 * `signal` work everywhere). Every event is checked against the contract's allow-list.
 */
export async function readRun(
  runId: string,
  after: number,
  onEvent: (e: AssistantRunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(urlFor(C.assistantRunEvents, { runId, after }), {
    credentials: "same-origin",
    headers: { accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`run events ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const parsed = C.AssistantRunEvent.safeParse(JSON.parse(line.slice(6)));
      if (!parsed.success) continue;
      onEvent(parsed.data);
      if (parsed.data.type === "end") return;
    }
  }
}

export default function AssistantChatPage({
  search,
  area = "teacher",
}: {
  search: TeacherPageSearch;
  area?: AssistantArea;
}) {
  const { t } = useI18n();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => call(C.assistantStatus, {}),
  });
  const chatId = search.chat ?? null;
  return (
    <AreaContext.Provider value={area}>
    <main
      className="cc-page cc-page--wide cc-stack"
      data-testid="assistant-chat-page"
    >
      <h1 className="cc-h1">{t("assistantChat.title")}</h1>
      <p className="cc-muted" style={{ margin: 0 }}>
        {area === "admin"
          ? t("assistantChat.introAdmin")
          : t("assistantChat.intro")}
      </p>
      {status.error ? <Alert>{errorText(t, status.error)}</Alert> : null}
      {status.data ? (
        status.data.available ? (
          <>
            <p
              className="cc-assistant__privacy"
              data-testid="assistant-privacy"
            >
              {status.data.studentNames
                ? t("assistantChat.privacy.names")
                : t("assistantChat.privacy.pseudonyms")}
            </p>
            <div
              className={`cc-assistant${chatId ? " cc-assistant--open" : ""}`}
            >
              <ChatList chatId={chatId} />
              {chatId ? (
                <ChatView key={chatId} chatId={chatId} status={status.data} />
              ) : (
                <PickChat status={status.data} />
              )}
            </div>
          </>
        ) : (
          <div data-testid="assistant-unavailable">
            <EmptyState
              title={t(
                `assistantChat.off.${status.data.unavailable ?? "OFF"}.title`,
              )}
              body={t(
                `assistantChat.off.${status.data.unavailable ?? "OFF"}.body`,
              )}
            />
          </div>
        )
      ) : null}
      <p className="cc-muted" style={{ margin: 0 }}>
        <a
          href={urlFor(C.exportAssistantChats, {})}
          download
          className={buttonClass("ghost", "small")}
          data-testid="assistant-export"
        >
          {t("assistantChat.export")}
        </a>{" "}
        {t("assistantChat.exportHint")}
      </p>
    </main>
    </AreaContext.Provider>
  );
}

function useOpenChat() {
  const navigate = useNavigate();
  const area = useContext(AreaContext);
  // Opening a chat keeps the scroll position, so the chat can bring its newest message into view itself.
  return useCallback(
    (id: string | null) =>
      void (area === "admin"
        ? navigate({
            to: "/admin/ai-assistant",
            search: id ? { chat: id } : {},
            resetScroll: !id,
          })
        : navigate({
            to: "/teacher/$page",
            params: { page: PAGE },
            search: id ? { chat: id } : {},
            resetScroll: !id,
          })),
    [navigate, area],
  );
}

function useNewChat() {
  const run = useRun();
  const qc = useQueryClient();
  const open = useOpenChat();
  return async () => {
    const chat = await run(() => call(C.createAssistantChat, {}));
    if (!chat) return;
    await qc.invalidateQueries({ queryKey: LIST_KEY });
    open(chat.id);
  };
}

function ChatList({ chatId }: { chatId: string | null }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const open = useOpenChat();
  const newChat = useNewChat();
  const query = q.trim();
  const list = useQuery({
    queryKey: [...LIST_KEY, query, archived],
    queryFn: () =>
      call(C.listAssistantChats, {
        ...(query ? { q: query } : {}),
        archived: archived ? "true" : "false",
      }),
  });
  return (
    <section
      className="cc-card cc-stack cc-assistant__list"
      aria-labelledby="assistant-chats-title"
      data-testid="assistant-chat-list"
    >
      <h2 id="assistant-chats-title" className="cc-h2" style={{ margin: 0 }}>
        {t("assistantChat.chats")}
      </h2>
      <Button
        variant="primary"
        onPress={() => void newChat()}
        data-testid="assistant-new-chat"
      >
        <IconPlus />
        <span>{t("assistantChat.newChat")}</span>
      </Button>
      <TextField
        label={t("assistantChat.search")}
        value={q}
        onChange={setQ}
        type="search"
        maxLength={100}
      />
      <Toggle
        label={t("assistantChat.showArchived")}
        isSelected={archived}
        onChange={setArchived}
      />
      {list.error ? <Alert>{errorText(t, list.error)}</Alert> : null}
      {list.isPending ? (
        <p className="cc-muted" role="status">
          {t("assistantChat.listLoading")}
        </p>
      ) : list.data && list.data.chats.length === 0 ? (
        <p className="cc-muted">
          {query ? t("assistantChat.noMatches") : t("assistantChat.noChats")}
        </p>
      ) : (
        <ul className="cc-assistant__chats">
          {list.data?.chats.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`cc-assistant__chat${c.id === chatId ? " cc-assistant__chat--current" : ""}`}
                aria-current={c.id === chatId ? "page" : undefined}
                onClick={() => open(c.id)}
              >
                <span className="cc-assistant__chat-title">
                  {c.title || t("assistantChat.untitled")}
                </span>
                <span className="cc-muted cc-assistant__chat-date">
                  {formatDate(c.lastMessageAt, locale, browserZone(), {
                    dateStyle: "medium",
                  })}
                  {c.archived ? ` · ${t("assistantChat.archivedMark")}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PickChat({ status }: { status: AssistantStatus }) {
  const { t } = useI18n();
  const newChat = useNewChat();
  return (
    <div className="cc-assistant__main">
      <EmptyState
        title={t("assistantChat.pick.title")}
        body={t("assistantChat.pick.body", { days: status.retentionDays })}
        action={
          <Button variant="primary" onPress={() => void newChat()}>
            <IconPlus />
            <span>{t("assistantChat.newChat")}</span>
          </Button>
        }
      />
    </div>
  );
}

/** What is streaming now: text and calls per assistant message, until the stored chat catches up. */
interface Live {
  runId: string;
  seq: number;
  texts: Record<string, string>;
  order: string[];
  calls: Record<string, AssistantCallView[]>;
}

function ChatView({
  chatId,
  status,
}: {
  chatId: string;
  status: AssistantStatus;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const run = useRun();
  const open = useOpenChat();
  const q = useQuery({
    queryKey: chatKey(chatId),
    queryFn: () => call(C.getAssistantChat, { chatId }),
  });
  const [live, setLive] = useState<Live | null>(null);
  const [note, setNote] = useState<{
    kind: "error" | "rounds";
    reason: string | null;
  } | null>(null);
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;
  const listRef = useRef<HTMLOListElement | null>(null);

  const follow = useCallback(
    async (runId: string) => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      setNote(null);
      const state: Live = { runId, seq: 0, texts: {}, order: [], calls: {} };
      setLive(state);
      let end: Extract<AssistantRunEvent, { type: "end" }> | null = null;
      try {
        await readRun(
          runId,
          0,
          (e) => {
            setLive((prev) => {
              const cur = prev && prev.runId === runId ? prev : state;
              if (e.seq <= cur.seq) return cur;
              if (e.type === "text") {
                const order = cur.order.includes(e.messageId)
                  ? cur.order
                  : [...cur.order, e.messageId];
                return {
                  ...cur,
                  seq: e.seq,
                  order,
                  texts: {
                    ...cur.texts,
                    [e.messageId]: (cur.texts[e.messageId] ?? "") + e.text,
                  },
                };
              }
              if (e.type === "tool") {
                const order = cur.order.includes(e.messageId)
                  ? cur.order
                  : [...cur.order, e.messageId];
                const list = (cur.calls[e.messageId] ?? []).filter(
                  (c) => c.id !== e.call.id,
                );
                return {
                  ...cur,
                  seq: e.seq,
                  order,
                  calls: { ...cur.calls, [e.messageId]: [...list, e.call] },
                };
              }
              return { ...cur, seq: e.seq };
            });
            if (e.type === "end") end = e;
          },
          ctl.signal,
        );
      } catch {
        // The stream broke (network, lock, Stop): the stored chat below is the truth.
      }
      if (ctl.signal.aborted && abort.current !== ctl) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: chatKey(chatId) }),
        qc.invalidateQueries({ queryKey: LIST_KEY }),
      ]);
      setLive((prev) => (prev?.runId === runId ? null : prev));
      const ended = end as Extract<AssistantRunEvent, { type: "end" }> | null;
      if (ended?.end === "error")
        setNote({ kind: "error", reason: ended.reason });
      else if (ended?.reason === "ASSISTANT_MAX_ROUNDS")
        setNote({ kind: "rounds", reason: null });
      if (abort.current === ctl) abort.current = null;
    },
    [chatId, qc],
  );

  // An answer still being written when the page opens (another tab, a reload): follow it.
  const runId = q.data?.runId ?? null;
  useEffect(() => {
    if (runId && !liveRef.current) void follow(runId);
  }, [runId, follow]);
  useEffect(() => () => abort.current?.abort(), []);

  const detail = q.data;
  const busy = live !== null;
  // On a phone the newest message (or a card waiting for Yes/No) is screens below the header: bring it
  // into view when the chat opens, when an answer starts and when a new card or message arrives.
  const pendingCount =
    (detail?.messages ?? []).reduce(
      (n, m) => n + m.calls.filter((c) => c.state === "pending").length,
      0,
    ) +
    Object.values(live?.calls ?? {}).reduce(
      (n, cs) => n + cs.filter((c) => c.state === "pending").length,
      0,
    );
  const shown = (detail?.messages.length ?? 0) + (live?.order.length ?? 0);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // After the frame is laid out (and after the router has settled its own scroll position).
    const frame = requestAnimationFrame(() =>
      reveal(
        list.querySelector('[data-state="pending"]') ?? list.lastElementChild,
        pendingCount ? "center" : "nearest",
      ),
    );
    return () => cancelAnimationFrame(frame);
  }, [shown, pendingCount, detail !== undefined]);
  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if ((!body && !attachment) || busy) return;
    const r = await run(
      () =>
        call(C.sendAssistantMessage, {
          chatId,
          text: body,
          ...(attachment
            ? { attachment: { name: attachment.name, text: attachment.text } }
            : {}),
        }),
      { invalidate: [chatKey(chatId), LIST_KEY] },
    );
    if (!r) return;
    setText("");
    setAttachment(null);
    void follow(r.runId);
  };
  const attach = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const r = await readAttachment(file);
    if (r.ok) {
      setAttachment(r.attachment);
      setAttachError(null);
    } else {
      setAttachment(null);
      setAttachError(t(`assistantChat.attach.${r.reason}`));
    }
  };
  const stop = () => {
    if (!live) return;
    void call(C.cancelAssistantRun, { runId: live.runId }).catch(
      () => undefined,
    );
  };
  const answer = async (
    messageId: string,
    callId: string,
    approve: boolean,
  ) => {
    const r = await run(
      () => call(C.answerAssistantCall, { chatId, messageId, callId, approve }),
      { invalidate: [chatKey(chatId)] },
    );
    if (r?.runId) void follow(r.runId);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
  };

  if (q.error)
    return (
      <div className="cc-assistant__main">
        <Alert>{errorText(t, q.error)}</Alert>
      </div>
    );
  if (!detail)
    return (
      <div className="cc-assistant__main">
        <p className="cc-muted" role="status">
          {t("common.loading")}
        </p>
      </div>
    );
  const stored = new Set(detail.messages.map((m) => m.id));
  const liveCalls = live?.calls ?? {};
  const pendingLive = (live?.order ?? []).filter((id) => !stored.has(id));
  const last = detail.messages[detail.messages.length - 1];
  return (
    <section
      className="cc-assistant__main cc-stack"
      aria-labelledby="assistant-chat-title"
      data-testid="assistant-chat"
    >
      <button
        type="button"
        className={`${buttonClass("ghost", "small")} cc-assistant__back`}
        onClick={() => open(null)}
      >
        <IconBack />
        <span>{t("assistantChat.backToList")}</span>
      </button>
      <ChatHeader detail={detail} status={status} />
      {detail.compacted ? (
        <p className="cc-muted cc-assistant__note">
          {t("assistantChat.compacted")}
        </p>
      ) : null}
      <ol
        ref={listRef}
        className="cc-assistant__messages"
        aria-label={t("assistantChat.messages")}
        data-testid="assistant-messages"
      >
        {detail.messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            calls={mergeCalls(m.calls, liveCalls[m.id])}
            chatId={chatId}
            busy={busy}
            onAnswer={answer}
          />
        ))}
        {pendingLive.map((id) => (
          <MessageItem
            key={id}
            message={{
              id,
              role: "assistant",
              text: live?.texts[id] ?? "",
              createdAt: 0,
              status: "complete",
              errorCode: null,
              calls: [],
            }}
            calls={liveCalls[id] ?? []}
            chatId={chatId}
            busy
            streaming
            onAnswer={answer}
          />
        ))}
      </ol>
      {detail.messages.length === 0 && !busy ? (
        <Suggestions onPick={setText} />
      ) : null}
      {busy ? (
        <p className="cc-muted" role="status" data-testid="assistant-writing">
          {t("assistantChat.writing")}
        </p>
      ) : null}
      {note?.kind === "error" && last?.status !== "error" ? (
        <Alert>{failureText(t, note.reason)}</Alert>
      ) : null}
      {note?.kind === "rounds" ? (
        <Alert kind="warning">{t("assistantChat.maxRounds")}</Alert>
      ) : null}
      <form
        className="cc-stack cc-assistant__composer"
        onSubmit={(e) => void send(e)}
        onKeyDown={onKey}
      >
        <TextArea
          label={t("assistantChat.composer")}
          description={t("assistantChat.composerHint")}
          value={text}
          onChange={setText}
          rows={3}
          maxLength={ASSISTANT_MESSAGE_MAX}
        />
        <div className="cc-assistant__attach">
          <FilePick
            id={`assistant-attach-${chatId}`}
            label={t("assistantChat.attach.button")}
            icon={<IconFile />}
            accept=".json,.txt,.md,application/json,text/plain,text/markdown"
            testId="assistant-attach"
            onFiles={(files) => void attach(files)}
          />
          {attachment ? (
            <p className="cc-muted" style={{ margin: 0 }} data-testid="assistant-attached">
              {t("assistantChat.attach.chosen", {
                name: attachment.name,
                size: Math.max(1, Math.round(attachment.bytes / 1024)),
              })}{" "}
              <Button
                size="small"
                variant="ghost"
                onPress={() => setAttachment(null)}
                data-testid="assistant-attach-remove"
              >
                <IconX />
                <span>{t("assistantChat.attach.remove")}</span>
              </Button>
            </p>
          ) : null}
        </div>
        <p className="cc-muted" style={{ margin: 0 }}>
          {t("assistantChat.attach.hint")}
        </p>
        {attachError ? (
          <Alert>
            <span data-testid="assistant-attach-error">{attachError}</span>
          </Alert>
        ) : null}
        <div className="cc-row">
          <Button
            type="submit"
            variant="primary"
            isDisabled={busy || (!text.trim() && !attachment)}
            data-testid="assistant-send"
          >
            {t("assistantChat.send")}
          </Button>
          {busy ? (
            <Button onPress={stop} data-testid="assistant-stop">
              <IconStop />
              <span>{t("assistantChat.stop")}</span>
            </Button>
          ) : null}
        </div>
      </form>
      <p
        className="cc-muted cc-assistant__note"
        data-testid="assistant-parents-note"
      >
        {t("assistantChat.parentsNote")}
      </p>
    </section>
  );
}

const mergeCalls = (
  stored: AssistantCallView[],
  live: AssistantCallView[] | undefined,
) =>
  live?.length
    ? [...stored.filter((c) => !live.some((l) => l.id === c.id)), ...live]
    : stored;

function ChatHeader({
  detail,
  status,
}: {
  detail: AssistantChatDetail;
  status: AssistantStatus;
}) {
  const { t } = useI18n();
  const run = useRun();
  const qc = useQueryClient();
  const open = useOpenChat();
  const chat = detail.chat;
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const invalidate = [chatKey(chat.id), LIST_KEY];
  const options = useMemo(
    () =>
      status.connections.flatMap((c) =>
        c.models.map((m) => ({
          id: `${c.id}|${m.name}`,
          label: t(
            c.scope === "personal"
              ? "assistantChat.connectionOwn"
              : "assistantChat.connectionOption",
            { connection: c.name, model: m.name },
          ),
        })),
      ),
    [status.connections, t],
  );
  const currentConn = chat.connectionId ?? status.defaultConnectionId;
  const currentModel = chat.model ?? status.defaultModel;
  const current =
    currentConn && currentModel ? `${currentConn}|${currentModel}` : "";
  // A chat's own choice that can no longer be used falls back to the school default, like on the server.
  const fallback = `${status.defaultConnectionId ?? ""}|${status.defaultModel ?? ""}`;
  const value = options.some((o) => o.id === current)
    ? current
    : options.some((o) => o.id === fallback)
      ? fallback
      : (options[0]?.id ?? "");
  const saveTitle = async (e: FormEvent) => {
    e.preventDefault();
    const next = title.trim();
    if (!next) return;
    if (
      await run(
        () => call(C.updateAssistantChat, { chatId: chat.id, title: next }),
        { invalidate, success: t("assistantChat.saved") },
      )
    )
      setRenaming(false);
  };
  return (
    <div className="cc-stack cc-assistant__header">
      {renaming ? (
        <form className="cc-row" onSubmit={(e) => void saveTitle(e)}>
          <TextField
            label={t("assistantChat.renameLabel")}
            value={title}
            onChange={setTitle}
            maxLength={80}
            autoFocus
          />
          <Button type="submit" variant="primary">
            <IconCheck />
            <span>{t("common.save")}</span>
          </Button>
          <Button onPress={() => setRenaming(false)}>
            <IconX />
            <span>{t("common.cancel")}</span>
          </Button>
        </form>
      ) : (
        <h2
          id="assistant-chat-title"
          className="cc-h2"
          style={{ margin: 0 }}
          data-testid="assistant-chat-title"
        >
          {chat.title || t("assistantChat.untitled")}
        </h2>
      )}
      <div className="cc-row cc-assistant__header-row">
        {options.length ? (
          <Select
            label={t("assistantChat.connection")}
            items={options}
            value={value}
            onChange={(v) => {
              const [connectionId, model] = v.split("|");
              void run(
                () =>
                  call(C.updateAssistantChat, {
                    chatId: chat.id,
                    connectionId: connectionId!,
                    model: model!,
                  }),
                { invalidate },
              );
            }}
          />
        ) : null}
        {renaming ? null : (
          <Button
            onPress={() => {
              setTitle(chat.title);
              setRenaming(true);
            }}
          >
            <IconPencil />
            <span>{t("assistantChat.rename")}</span>
          </Button>
        )}
        <Button
          onPress={() =>
            void run(
              () =>
                call(C.updateAssistantChat, {
                  chatId: chat.id,
                  archived: !chat.archived,
                }),
              { invalidate, success: t("assistantChat.saved") },
            )
          }
        >
          <IconArchive />
          <span>
            {chat.archived
              ? t("assistantChat.unarchive")
              : t("assistantChat.archive")}
          </span>
        </Button>
        <InlineConfirmButton
          variant="danger-outline"
          message={t("assistantChat.deleteConfirm")}
          confirmLabel={t("assistantChat.delete")}
          cancelLabel={t("common.cancel")}
          onConfirm={() =>
            void run(() => call(C.deleteAssistantChat, { chatId: chat.id }), {
              success: t("assistantChat.deleted"),
              invalidate: [LIST_KEY],
            }).then((r) => {
              if (!r) return;
              qc.removeQueries({ queryKey: chatKey(chat.id) });
              open(null);
            })
          }
        >
          <IconTrash />
          <span>{t("assistantChat.delete")}</span>
        </InlineConfirmButton>
      </div>
    </div>
  );
}

function MessageItem({
  message,
  calls,
  chatId,
  busy,
  streaming = false,
  onAnswer,
}: {
  message: AssistantMessageView;
  calls: AssistantCallView[];
  chatId: string;
  busy: boolean;
  streaming?: boolean;
  onAnswer: (
    messageId: string,
    callId: string,
    approve: boolean,
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const mine = message.role === "user";
  const copy = async () => {
    if (await copyText(message.text))
      showToast({ message: t("assistantChat.copied"), kind: "success" });
    else
      showManualCopy({
        title: t("assistantChat.copy"),
        label: t("assistantChat.copy"),
        text: message.text,
      });
  };
  return (
    <li
      className={`cc-assistant__message cc-assistant__message--${mine ? "user" : "assistant"}`}
      data-testid={`assistant-message-${message.role}`}
    >
      <span className="cc-visually-hidden">
        {mine ? t("assistantChat.you") : t("assistantChat.assistant")}
      </span>
      {message.text ? (
        mine ? (
          <UserText text={message.text} />
        ) : (
          <ChatMarkdown text={message.text} streaming={streaming} />
        )
      ) : null}
      {calls.map((c) => (
        <div key={c.id} className="cc-assistant__call">
          {c.readOnly || c.state === "refused" ? (
            <ActivityLine call={c} />
          ) : (
            <ChangeCard
              call={c}
              busy={busy}
              onAnswer={(yes) => onAnswer(message.id, c.id, yes)}
            />
          )}
          {/* A theme the model shows or offers to save: the same preview as Admin → Themes (owner 2026-11-12). */}
          {c.theme ? (
            <ChatThemePreview chatId={chatId} messageId={message.id} callId={c.id} />
          ) : null}
        </div>
      ))}
      {message.status === "cancelled" ? (
        <p className="cc-muted cc-assistant__note">
          {t("assistantChat.stopped")}
        </p>
      ) : null}
      {message.status === "error" ? (
        <Alert>
          {t("assistantChat.failed", {
            reason: failureText(t, message.errorCode),
          })}
        </Alert>
      ) : null}
      {!mine && !streaming && message.text ? (
        <div>
          <Button
            size="small"
            variant="ghost"
            onPress={() => void copy()}
            data-testid="assistant-copy"
          >
            <IconCopy />
            <span>{t("assistantChat.copy")}</span>
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ActivityLine({ call: c }: { call: AssistantCallView }) {
  const { t } = useI18n();
  const text =
    c.state === "refused"
      ? t("assistantChat.state.refused")
      : c.failed
        ? t("assistantChat.activity.failed", { tool: toolLabel(t, c.tool) })
        : c.target
          ? t("assistantChat.activity.autoTarget", {
              tool: toolLabel(t, c.tool),
              target: c.target,
            })
          : t("assistantChat.activity.auto", { tool: toolLabel(t, c.tool) });
  return (
    <p
      className="cc-muted cc-assistant__activity"
      data-testid="assistant-activity"
    >
      {text}
    </p>
  );
}

function ChangeCard({
  call: c,
  busy,
  onAnswer,
}: {
  call: AssistantCallView;
  busy: boolean;
  onAnswer: (approve: boolean) => Promise<void>;
}) {
  const { t } = useI18n();
  const [sending, setSending] = useState(false);
  const decided =
    c.state === "approved"
      ? c.failed === null
        ? t("assistantChat.state.approvedRunning")
        : c.failed
          ? t("assistantChat.state.approvedFailed")
          : t("assistantChat.state.approved")
      : c.state === "declined"
        ? t("assistantChat.state.declined")
        : c.state === "expired"
          ? t("assistantChat.state.expired")
          : null;
  const press = async (yes: boolean) => {
    setSending(true);
    try {
      await onAnswer(yes);
    } finally {
      setSending(false);
    }
  };
  return (
    <div
      className={`cc-assistant__card${c.state === "pending" ? " cc-assistant__card--pending" : ""}`}
      data-testid="assistant-change-card"
      data-state={c.state}
    >
      <h3 className="cc-h3" style={{ margin: 0 }}>
        {t("assistantChat.card.title")}
      </h3>
      <p style={{ margin: 0 }}>
        {t("assistantChat.card.tool", { tool: toolLabel(t, c.tool) })}
      </p>
      {c.target ? (
        <p style={{ margin: 0 }}>
          {t("assistantChat.card.target", { target: c.target })}
        </p>
      ) : null}
      {c.changes.length ? (
        <>
          <h4 className="cc-assistant__changes-title">
            {t("assistantChat.card.changes")}
          </h4>
          <dl className="cc-assistant__changes">
            {c.changes.map((l) => (
              <div key={l.key} data-testid="assistant-change" data-key={l.key}>
                <dt>{argLabel(t, l.key)}</dt>
                {l.kind === "list" ? (
                  <dd>
                    <span className="cc-muted">
                      {t("assistantChat.card.items", { count: l.items.length })}
                    </span>
                    <ul className="cc-assistant__items">
                      {l.items.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </dd>
                ) : (
                  <dd
                    className={
                      l.kind === "missing" ? "cc-assistant__missing" : undefined
                    }
                  >
                    {changeValue(t, l)}
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {c.state === "pending" ? (
        <>
          <p style={{ margin: 0 }}>{t("assistantChat.card.question")}</p>
          <div className="cc-row">
            <Button
              variant="primary"
              isDisabled={sending || busy}
              onPress={() => void press(true)}
              data-testid="assistant-card-yes"
            >
              <IconCheck />
              <span>{t("assistantChat.card.yes")}</span>
            </Button>
            <Button
              isDisabled={sending || busy}
              onPress={() => void press(false)}
              data-testid="assistant-card-no"
            >
              <IconX />
              <span>{t("assistantChat.card.no")}</span>
            </Button>
          </div>
        </>
      ) : (
        <p
          className="cc-assistant__decided"
          data-testid="assistant-card-decided"
        >
          {decided}
        </p>
      )}
    </div>
  );
}

function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useI18n();
  const area = useContext(AreaContext);
  const keys =
    area === "admin"
      ? (["assistantChat.suggest.settings", "assistantChat.suggest.themeAdmin"] as const)
      : ([
          "assistantChat.suggest.homework",
          "assistantChat.suggest.goals",
          "assistantChat.suggest.parents",
          "assistantChat.suggest.theme",
        ] as const);
  return (
    <div className="cc-stack" data-testid="assistant-suggestions">
      <h3 className="cc-h3" style={{ margin: 0 }}>
        {t("assistantChat.suggest.title")}
      </h3>
      <div className="cc-row">
        {keys.map((k) => (
          <Button key={k} size="small" onPress={() => onPick(t(k))}>
            {t(k)}
          </Button>
        ))}
      </div>
    </div>
  );
}
