import { buttonClass } from "@/components/ui/button";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { FarmerBankSection } from "@/app/farmer/bank-section";
import { AuthCard } from "@/components/auth-ui";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { withNext } from "@/lib/safe-next";
import { resolveInvite } from "@/modules/cooperatives/invites";
import { getOwnFarmerOverview } from "@/modules/farmers/service";
import { STATES } from "@/modules/geo/states";
import { currentUser } from "@/modules/identity/session";
import { ProfileForm } from "./profile-form";

type Invite = Awaited<ReturnType<typeof resolveInvite>>;
type InviteProblem = "invalid" | "notVerified";

const BUTTON = `${buttonClass("ink", "lg")} w-full`;
const SECONDARY = `${buttonClass("step", "lg")} w-full`;

// Opened from an officer's invite link. The token is the credential: it is never logged.
// Opening the page never uses up an invite; only joining does.
export default function JoinPage({ params }: PageProps<"/join/[token]">) {
  return (
    <Suspense fallback={null}>
      <JoinStep params={params} />
    </Suspense>
  );
}

async function loadInvite(token: string): Promise<Invite | InviteProblem> {
  // Request-time only: resolveInvite reads the clock, which cacheComponents refuses to do
  // while prerendering (a signed-out visitor has no session I/O to make it dynamic first).
  await connection();
  try {
    return await resolveInvite(token);
  } catch (error) {
    if (error instanceof NotFoundError) return "invalid";
    if (error instanceof ForbiddenError && error.code === "COOPERATIVE_NOT_VERIFIED") {
      return "notVerified";
    }
    throw error;
  }
}

async function JoinStep({ params }: { params: PageProps<"/join/[token]">["params"] }) {
  const { token } = await params;
  const t = await getTranslations("farmer.join");
  const invite = await loadInvite(token);
  const user = await currentUser();
  const photo = await getTranslations("photo");

  // A farmer who already joined sees their own step, even once a single-use invite is used.
  if (user) {
    const overview = await getOwnFarmerOverview(user);
    const membership = overview.membership;
    if (membership && (membership.status === "PENDING" || membership.status === "ACTIVE")) {
      if (typeof invite === "object" && invite.cooperativeId !== membership.cooperativeId) {
        return (
          <AuthCard title={t("otherTitle")}>
            <p className="body-3">
              {t("otherCooperative", { cooperative: membership.cooperativeName })}
            </p>
            <Link href="/farmer" className={BUTTON}>
              {t("goToFarmer")}
            </Link>
          </AuthCard>
        );
      }
      return (
        <AuthCard title={membership.cooperativeName}>
          <p
            role="status"
            className="rounded-inner bg-step p-4 body-3"
          >
            {membership.status === "PENDING" ? t("waiting") : t("approved")}
          </p>
          <FarmerBankSection bank={overview.bank} canChange={!overview.bank?.accountName} />
          <Link href="/farmer" className={SECONDARY}>
            {t("goToFarmer")}
          </Link>
        </AuthCard>
      );
    }
  }

  if (invite === "invalid") {
    return (
      <AuthCard title={t("invalidTitle")}>
        <p role="alert" className="body-3">
          {t("invalid")}
        </p>
      </AuthCard>
    );
  }
  if (invite === "notVerified") {
    return (
      <AuthCard title={t("notVerifiedTitle")}>
        <p role="alert" className="body-3">
          {t("notVerified")}
        </p>
      </AuthCard>
    );
  }

  const title = t("title", { cooperative: invite.cooperativeName });
  const here = `/join/${token}`;
  if (!user) {
    return (
      <AuthCard title={title} photo="maize" caption={photo("join")}>
        <p className="body-3 text-ink-soft">{t("signedOutIntro")}</p>
        <Link href={withNext("/sign-up", here)} className={BUTTON}>
          {t("signUp")}
        </Link>
        <Link href={withNext("/sign-in", here)} className={SECONDARY}>
          {t("signIn")}
        </Link>
      </AuthCard>
    );
  }

  if (invite.email !== null && invite.email.toLowerCase() !== user.email.trim().toLowerCase()) {
    return (
      <AuthCard title={title}>
        <p role="alert" className="body-3">
          {t("emailMismatch")}
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title} photo="maize" caption={photo("join")}>
      <p className="body-3 text-ink-soft">{t("profileIntro")}</p>
      <ProfileForm token={token} states={[...STATES]} />
    </AuthCard>
  );
}
