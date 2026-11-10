/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import useSWR, { mutate } from "swr";
// plane imports
import { Button } from "@makeplane/propel/components/button";
import { ROLE, USER_WORKSPACES_LIST } from "@plane/constants";
import { PlaneLogo } from "@plane/blocks/icons";
import type { IWorkspaceMemberInvitation } from "@plane/types";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { WorkspaceLogo } from "@/components/workspace/logo";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser } from "@/hooks/store/user";
// wrappers and services
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";
import { slackService } from "@/services/slack.service";
import { WorkspaceService } from "@/services/workspace.service";
import type { Route } from "./+types/page";

const workspaceService = new WorkspaceService();

const errorMessage = (err: unknown): string => {
  const message = (err as { error?: unknown } | null | undefined)?.error;
  return typeof message === "string" && message ? message : "Something went wrong. Please try again.";
};

type TRow = { slug: string; name: string; logo: string | null | undefined; invitation?: IWorkspaceMemberInvitation };

const SlackConnect = observer(function SlackConnect({ code }: { code: string }) {
  const { data: currentUser } = useUser();
  const { workspaces, fetchWorkspaces } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectedTo, setConnectedTo] = useState<{ slug: string; name: string } | null>(null);
  const autoTried = useRef(false);

  const { data: connection, error: codeError } = useSWR(`SLACK_CONNECTION_${code}`, () =>
    slackService.connection(code)
  );
  const { data: invitations, mutate: refreshInvitations } = useSWR("USER_WORKSPACE_INVITATIONS", () =>
    workspaceService.userWorkspaceInvitations()
  );

  const joined = Object.values(workspaces ?? {});
  const rows: TRow[] = [
    ...joined.map((w) => ({ slug: w.slug, name: w.name, logo: w.logo_url })),
    ...(invitations ?? [])
      .filter((i) => !joined.some((w) => w.id === i.workspace.id))
      .map((i) => ({ slug: i.workspace.slug, name: i.workspace.name, logo: i.workspace.logo_url, invitation: i })),
  ];

  const choose = async (row: TRow) => {
    setBusy(row.slug);
    setError(null);
    try {
      if (row.invitation) {
        await workspaceService.joinWorkspaces({ invitations: [row.invitation.id] });
        await Promise.all([mutate(USER_WORKSPACES_LIST), fetchWorkspaces(), refreshInvitations()]);
      }
      const result = await slackService.connect(code, row.slug);
      setConnectedTo(result.workspace);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  // Nothing to choose: one workspace, no invitations, not connected yet -> connect straight away.
  useEffect(() => {
    if (autoTried.current || !connection || connection.workspace || invitations === undefined) return;
    if (rows.length === 1 && !rows[0].invitation) {
      autoTried.current = true;
      void choose(rows[0]);
    }
  });

  if (codeError) return <Message title="This link doesn't work" text={errorMessage(codeError)} />;

  if (connectedTo)
    return (
      <Message
        title="Slack is connected"
        text={`The Vynk bot now works in ${connectedTo.name} for you. Go back to Slack and send it a message, or type /vynk.`}
        action={
          <Button
            variant="primary"
            size="md"
            stretch="auto"
            label="Open Slack"
            nativeButton={false}
            render={<a href="slack://open" aria-label="Open Slack" />}
          />
        }
      />
    );

  if (!connection || invitations === undefined)
    return (
      <div className="grid h-full place-items-center">
        <LogoSpinner />
      </div>
    );

  return (
    <div className="mx-auto flex h-full w-full max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <PlaneLogo className="h-9 w-auto self-start text-primary" />
      <div className="space-y-2">
        <h1 className="text-h4-semibold text-primary">Connect Slack to Vynk</h1>
        <p className="text-13 text-secondary">
          Signed in as {currentUser?.email}. Choose the workspace the Slack bot should use for you. You can switch later
          from the bot&apos;s menu.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-subtle p-4 text-13 text-secondary">
          You aren&apos;t in any workspace yet. Ask an admin to invite you, then open the link from Slack again.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const current = connection.workspace?.slug === row.slug;
            return (
              <button
                key={row.slug}
                type="button"
                disabled={busy !== null}
                onClick={() => void choose(row)}
                className={`flex w-full items-center gap-3 rounded-md border px-3.5 py-4 text-left disabled:opacity-60 ${
                  current ? "border-accent-strong" : "border-subtle hover:bg-layer-1"
                }`}
              >
                <WorkspaceLogo logo={row.logo ?? undefined} name={row.name} classNames="size-9 flex-shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-13 font-medium text-primary">{row.name}</span>
                  <span className="block text-11 text-secondary">
                    {row.invitation
                      ? `Invitation (${ROLE[row.invitation.role]}) · joins and connects`
                      : current
                        ? "Connected now"
                        : "Member"}
                  </span>
                </span>
                <span className="text-13 font-medium text-accent-primary">
                  {busy === row.slug
                    ? "Connecting…"
                    : row.invitation
                      ? "Join & connect"
                      : current
                        ? "Reconnect"
                        : "Connect"}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="text-13 text-danger-primary">{error}</p>}
    </div>
  );
});

function Message({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-full w-full max-w-lg flex-col justify-center gap-4 px-4 py-10">
      <PlaneLogo className="h-9 w-auto self-start text-primary" />
      <h1 className="text-h4-semibold text-primary">{title}</h1>
      <p className="text-13 text-secondary">{text}</p>
      {action && <div>{action}</div>}
    </div>
  );
}

function SlackConnectPage({ params }: Route.ComponentProps) {
  return (
    <AuthenticationWrapper>
      <SlackConnect code={params.code} />
    </AuthenticationWrapper>
  );
}

export default SlackConnectPage;
