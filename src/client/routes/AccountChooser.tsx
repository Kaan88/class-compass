/**
 * S36 (D-216): after Google or the operator's sign-in server proved an address that belongs to more
 * than one account the person may be (one person's teacher and administrator accounts, D-108), the
 * return page asks which one. One big button per account with its name and its role in words; pressing
 * one signs that account in (the proof is in a short-lived cookie the server set with the list).
 */
import { useState } from "react";
import type { z } from "zod";
import type * as Auth from "../../shared/contracts/auth.ts";
import { call } from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { Button } from "../ui/Button.tsx";
import { useSignedIn } from "./SignIn.tsx";

export type AccountChoice = z.infer<
  typeof Auth.ChooseAccount
>["choose"][number];

export function AccountChooser({
  accounts,
  endpoint,
  onError,
}: {
  accounts: AccountChoice[];
  /** `chooseGoogleAccount` or `chooseSsoAccount` (the same shape). */
  endpoint: typeof Auth.chooseGoogleAccount | typeof Auth.chooseSsoAccount;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const signedIn = useSignedIn();
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="cc-stack"
      role="group"
      aria-labelledby="cc-account-chooser"
      data-testid="account-chooser"
    >
      <p id="cc-account-chooser">{t("signin.chooseAccount")}</p>
      {accounts.map((a) => {
        const role = t(a.role === "admin" ? "role.admin" : "role.teacher");
        return (
          <Button
            key={a.id}
            size="big"
            className="cc-account-choice"
            // Read as "name, role": the two lines would otherwise run together.
            aria-label={t("signin.chooseAccount.option", {
              name: a.displayName,
              role,
            })}
            isDisabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                await signedIn(await call(endpoint, { userId: a.id }));
              } catch (err) {
                setBusy(false);
                onError(err);
              }
            }}
          >
            <span className="cc-account-choice__name">{a.displayName}</span>
            <span className="cc-account-choice__role">{role}</span>
          </Button>
        );
      })}
    </div>
  );
}
