/**
 * "Preview theme" under a theme the assistant shows (`preview_theme`) or offers to save
 * (`import_theme_draft`) (owner 2026-11-12, D-196 note): the page asks the server for that call's
 * package, checked again by the theme validator (`assistantCallTheme`), and shows the same preview as
 * Admin → Themes (classroom, student page, board, celebration, engine, mascot, sounds, contrast). The
 * package is registered only as a preview (`cc-preview--<key>`), never offered to classes; nothing is
 * saved. A package with errors shows how many instead of a preview.
 */
import { useState } from "react";
import * as C from "../../../shared/contracts/assistantChat.ts";
import { call } from "../../lib/api.ts";
import { errorText } from "../../lib/errors.ts";
import { useI18n } from "../../lib/i18n.tsx";
import { ThemePackagePreview } from "../../routes/admin/Themes.tsx";
import { previewKey, registerThemePackage } from "../../themes/custom.tsx";
import { Button } from "../../ui/Button.tsx";
import { Alert } from "../../ui/Feedback.tsx";
import { IconLayout } from "../../ui/icons.tsx";

type State =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "shown"; themeKey: string }
  | { kind: "invalid"; errors: number }
  | { kind: "failed"; message: string };

export function ChatThemePreview({ chatId, messageId, callId }: { chatId: string; messageId: string; callId: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "closed" });
  const open = async () => {
    setState({ kind: "loading" });
    try {
      const r = await call(C.assistantCallTheme, { chatId, messageId, callId });
      if (!r.package) return setState({ kind: "invalid", errors: r.report.errors.length });
      const key = previewKey(r.package.key);
      if (!registerThemePackage(r.package, "preview", key)) return setState({ kind: "invalid", errors: Math.max(1, r.report.errors.length) });
      setState({ kind: "shown", themeKey: key });
    } catch (e) {
      setState({ kind: "failed", message: errorText(t, e) });
    }
  };
  const close = () => setState({ kind: "closed" });
  return (
    <div className="cc-assistant__theme-preview" data-testid="assistant-theme-preview">
      {state.kind === "shown" ? (
        <ThemePackagePreview themeKey={state.themeKey} onClose={close} />
      ) : (
        <div>
          <Button size="small" isDisabled={state.kind === "loading"} onPress={() => void open()} data-testid="assistant-theme-preview-open">
            <IconLayout />
            <span>{t("assistantChat.themePreview.open")}</span>
          </Button>
        </div>
      )}
      {state.kind === "invalid" ? <Alert kind="warning">{t("assistantChat.themePreview.invalid", { count: state.errors })}</Alert> : null}
      {state.kind === "failed" ? <Alert>{state.message}</Alert> : null}
    </div>
  );
}
