import { afterEach, describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { markAccountUnavailableIfCurrent } from "@/jobs/account-availability";
import { refreshExpiringTokens } from "@/jobs/token-maintenance";
import { claimJob, recoverStaleJobs, renewJobLease } from "@/jobs/queue";
import { encryptToken } from "@/lib/crypto";
import { resetEnvForTests } from "@/lib/env";
import { getInstagramProvider, resetInstagramProviderForTests } from "@/providers";
import { verifyAccount } from "@/server/accounts";
import { cancelCampaign } from "@/server/scheduler";
import { createAccounts, createCampaign, createJobs, createUser } from "./helpers";

afterEach(() => {
  process.env.FAKE_PROVIDER_SCENARIO = "success";
  resetEnvForTests();
  resetInstagramProviderForTests();
});

describe("invariantes de confiabilidade", () => {
  it("renova o lease somente para o mesmo worker e fencing token", async () => {
    const sql = getSqlClient();
    const actorId = await createUser("lease-renewal@example.test");
    const [account] = await createAccounts(1, "lease_renewal");
    const campaignId = await createCampaign(actorId, "SCHEDULED", "Renovação de lease");
    await createJobs(campaignId, [account]);

    const claim = await claimJob("lease-owner");
    expect(claim).not.toBeNull();
    await sql`
      UPDATE publication_jobs SET lock_expires_at = now() + interval '1 second'
      WHERE id = ${claim!.id}
    `;

    await expect(renewJobLease(claim!, "another-worker")).resolves.toBe(false);
    await sql`UPDATE publication_jobs SET lock_expires_at = now() - interval '1 second' WHERE id = ${claim!.id}`;
    await expect(renewJobLease(claim!, "lease-owner")).resolves.toBe(false);
    await sql`UPDATE publication_jobs SET lock_expires_at = now() + interval '1 second' WHERE id = ${claim!.id}`;
    await expect(renewJobLease(claim!, "lease-owner")).resolves.toBe(true);
    const [renewed] = await sql<{ seconds_remaining: number }[]>`
      SELECT extract(epoch FROM lock_expires_at - now())::float AS seconds_remaining
      FROM publication_jobs WHERE id = ${claim!.id}
    `;
    expect(renewed.seconds_remaining).toBeGreaterThan(20);

    await sql`UPDATE publication_jobs SET fencing_token = fencing_token + 1 WHERE id = ${claim!.id}`;
    await expect(renewJobLease(claim!, "lease-owner")).resolves.toBe(false);
  });

  it("aplica indisponibilidade por CAS e terminaliza a fila na mesma transação", async () => {
    const sql = getSqlClient();
    const actorId = await createUser("account-cas@example.test");
    const [account] = await createAccounts(1, "account_cas");
    const originalToken = encryptToken("fake-token:cas:account");
    await sql`
      UPDATE instagram_accounts SET encrypted_access_token = ${originalToken}, status = 'CONNECTED'
      WHERE id = ${account.id}
    `;
    const campaignId = await createCampaign(actorId, "SCHEDULED", "CAS de conta");
    await createJobs(campaignId, [account]);

    await expect(markAccountUnavailableIfCurrent({
      accountId: account.id,
      expectedEncryptedToken: encryptToken("fake-token:stale:account"),
      expectedStatus: "CONNECTED",
      nextStatus: "REAUTH_REQUIRED",
      errorCode: "STALE_AUTH",
      errorKind: "AUTH",
      errorMessage: "resultado antigo",
    })).resolves.toBe(false);

    await expect(markAccountUnavailableIfCurrent({
      accountId: account.id,
      expectedEncryptedToken: originalToken,
      expectedStatus: "CONNECTED",
      nextStatus: "REAUTH_REQUIRED",
      errorCode: "TOKEN_REJECTED",
      errorKind: "AUTH",
      errorMessage: "token rejeitado",
    })).resolves.toBe(true);

    const [state] = await sql<Array<{ account_status: string; campaign_status: string; failed_jobs: number; fenced_jobs: number }>>`
      SELECT account.status AS account_status, campaign.status AS campaign_status,
        count(*) FILTER (WHERE job.status = 'FAILED')::int AS failed_jobs,
        count(*) FILTER (WHERE job.fencing_token = 1)::int AS fenced_jobs
      FROM instagram_accounts account
      JOIN publication_jobs job ON job.instagram_account_id = account.id
      JOIN campaigns campaign ON campaign.id = job.campaign_id
      WHERE account.id = ${account.id}
      GROUP BY account.status, campaign.status
    `;
    expect(state).toEqual({ account_status: "REAUTH_REQUIRED", campaign_status: "FAILED", failed_jobs: 1, fenced_jobs: 1 });
  });

  it("repara campanha ativa cujo último estado terminal foi persistido antes de um crash", async () => {
    const sql = getSqlClient();
    const actorId = await createUser("orphaned-campaign@example.test");
    const accounts = await createAccounts(2, "orphaned_campaign");
    const campaignId = await createCampaign(actorId, "RUNNING", "Campanha terminal órfã");
    const jobs = await createJobs(campaignId, accounts);
    await sql`
      UPDATE publication_jobs SET status = 'PUBLISHED', published_at = now(), finished_at = now()
      WHERE id = ${jobs[0].id}
    `;
    await sql`
      UPDATE publication_jobs SET status = 'FAILED', finished_at = now(), last_error_code = 'SIMULATED_CRASH'
      WHERE id = ${jobs[1].id}
    `;

    await recoverStaleJobs();

    const [campaign] = await sql<Array<{ status: string }>>`
      SELECT status FROM campaigns WHERE id = ${campaignId}
    `;
    expect(campaign.status).toBe("PARTIALLY_FAILED");
  });

  it("encerra como cancelado um job pré-publish cujo worker morreu após cancelar a campanha", async () => {
    const sql = getSqlClient();
    const actorId = await createUser("cancelled-crash@example.test");
    const [account] = await createAccounts(1, "cancelled_crash");
    const campaignId = await createCampaign(actorId, "SCHEDULED", "Cancelada durante crash");
    await createJobs(campaignId, [account]);
    const claim = await claimJob("cancelled-worker");
    expect(claim).not.toBeNull();
    await cancelCampaign(campaignId, actorId);
    await sql`UPDATE publication_jobs SET lock_expires_at = now() - interval '1 second' WHERE id = ${claim!.id}`;

    await recoverStaleJobs();

    const [job] = await sql<Array<{ status: string; last_error_code: string }>>`
      SELECT status, last_error_code FROM publication_jobs WHERE id = ${claim!.id}
    `;
    expect(job).toEqual({ status: "CANCELLED", last_error_code: "STALE_AFTER_CAMPAIGN_CANCEL" });
  });

  it("falha de autenticação no refresh encerra jobs em vez de deixá-los presos", async () => {
    process.env.FAKE_PROVIDER_SCENARIO = "token_expired";
    resetEnvForTests();
    resetInstagramProviderForTests();
    const sql = getSqlClient();
    const actorId = await createUser("refresh-auth@example.test");
    const [account] = await createAccounts(1, "refresh_auth");
    await sql`
      UPDATE instagram_accounts SET encrypted_access_token = ${encryptToken("fake-token:refresh:account")},
        token_expires_at = now() + interval '1 day', token_last_checked_at = NULL
      WHERE id = ${account.id}
    `;
    const campaignId = await createCampaign(actorId, "SCHEDULED", "Refresh rejeitado");
    await createJobs(campaignId, [account]);

    await refreshExpiringTokens("maintenance-test");

    const [state] = await sql<Array<{ account_status: string; job_status: string; campaign_status: string }>>`
      SELECT account.status AS account_status, job.status AS job_status, campaign.status AS campaign_status
      FROM instagram_accounts account
      JOIN publication_jobs job ON job.instagram_account_id = account.id
      JOIN campaigns campaign ON campaign.id = job.campaign_id
      WHERE account.id = ${account.id}
    `;
    expect(state).toEqual({ account_status: "REAUTH_REQUIRED", job_status: "FAILED", campaign_status: "FAILED" });
  });

  it("descarta uma verificação concluída depois que a conta foi reconectada", async () => {
    const sql = getSqlClient();
    const [account] = await createAccounts(1, "verify_cas");
    const originalToken = encryptToken("fake-token:verify:old");
    const reconnectedToken = encryptToken("fake-token:verify:new");
    await sql`
      UPDATE instagram_accounts SET encrypted_access_token = ${originalToken}, username = 'before_verify', status = 'CONNECTED'
      WHERE id = ${account.id}
    `;

    let releaseProfile!: () => void;
    let markStarted!: () => void;
    const profileStarted = new Promise<void>((resolve) => { markStarted = resolve; });
    const profileReleased = new Promise<void>((resolve) => { releaseProfile = resolve; });
    const provider = getInstagramProvider();
    provider.getProfile = async () => {
      markStarted();
      await profileReleased;
      return { id: account.instagram_user_id, username: "stale_profile" };
    };
    provider.getPublishingLimit = async () => ({ usage: 1, total: 100 });

    const verification = verifyAccount(account.id);
    await profileStarted;
    await sql`
      UPDATE instagram_accounts SET encrypted_access_token = ${reconnectedToken}, username = 'new_connection', status = 'CONNECTED'
      WHERE id = ${account.id}
    `;
    releaseProfile();

    await expect(verification).resolves.toBe(false);
    const [state] = await sql<Array<{ encrypted_access_token: string; username: string; status: string }>>`
      SELECT encrypted_access_token, username, status FROM instagram_accounts WHERE id = ${account.id}
    `;
    expect(state).toEqual({ encrypted_access_token: reconnectedToken, username: "new_connection", status: "CONNECTED" });
  });

  it("registra erro transitório de verificação sem destruir campanhas futuras", async () => {
    process.env.FAKE_PROVIDER_SCENARIO = "http_500";
    resetEnvForTests();
    resetInstagramProviderForTests();
    const sql = getSqlClient();
    const actorId = await createUser("verify-transient@example.test");
    const [account] = await createAccounts(1, "verify_transient");
    await sql`
      UPDATE instagram_accounts SET encrypted_access_token = ${encryptToken("fake-token:verify:transient")}
      WHERE id = ${account.id}
    `;
    const campaignId = await createCampaign(actorId, "SCHEDULED", "Verificação transitória");
    await createJobs(campaignId, [account]);

    await expect(verifyAccount(account.id)).rejects.toMatchObject({ code: "FAKE_500" });

    const [state] = await sql<Array<{ account_status: string; job_status: string; campaign_status: string }>>`
      SELECT account.status AS account_status, job.status AS job_status, campaign.status AS campaign_status
      FROM instagram_accounts account
      JOIN publication_jobs job ON job.instagram_account_id = account.id
      JOIN campaigns campaign ON campaign.id = job.campaign_id
      WHERE account.id = ${account.id}
    `;
    expect(state).toEqual({ account_status: "CONNECTED", job_status: "QUEUED", campaign_status: "SCHEDULED" });
  });
});
