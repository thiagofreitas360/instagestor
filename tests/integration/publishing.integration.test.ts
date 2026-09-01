import { afterEach, describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { claimJob, processClaimedJob } from "@/jobs/queue";
import { encryptToken } from "@/lib/crypto";
import { resetEnvForTests } from "@/lib/env";
import { resetInstagramProviderForTests } from "@/providers";
import { createUser } from "./helpers";

type Scenario = "success" | "http_500" | "http_501" | "ambiguous_publish" | "token_expired";

async function publishingFixture(scenario: Scenario, quota?: { usage: number; total: number }) {
  process.env.FAKE_PROVIDER_SCENARIO = scenario;
  resetEnvForTests();
  resetInstagramProviderForTests();
  const sql = getSqlClient();
  const actorId = await createUser(`${scenario}-${crypto.randomUUID()}@example.test`);
  const [account] = await sql<{ id: string }[]>`
    INSERT INTO instagram_accounts (
      instagram_user_id, app_scoped_user_id, username, status, encrypted_access_token,
      token_expires_at, publishing_limit_usage, publishing_limit_total, publishing_limit_checked_at
    ) VALUES (
      ${`ig-${crypto.randomUUID()}`}, ${`app-${crypto.randomUUID()}`}, ${`account_${crypto.randomUUID().slice(0, 8)}`},
      'CONNECTED', ${encryptToken("fake-token:integration:integration_account")}, now() + interval '60 days',
      ${quota?.usage ?? null}, ${quota?.total ?? null}, ${quota ? new Date().toISOString() : null}
    )
    RETURNING id
  `;
  const [asset] = await sql<{ id: string }[]>`
    INSERT INTO media_assets (
      original_filename, storage_provider, storage_key, mime_type, media_kind, size_bytes,
      checksum_sha256, width, height, processing_status
    ) VALUES (
      'integration.jpg', 'LOCAL', ${`media/${crypto.randomUUID()}`}, 'image/jpeg', 'IMAGE', 1024,
      ${"a".repeat(64)}, 1080, 1080, 'READY'
    )
    RETURNING id
  `;
  const [campaign] = await sql<{ id: string }[]>`
    INSERT INTO campaigns (name, publication_type, status, delay_mode, delay_fixed_seconds, target_order, created_by)
    VALUES ('Publicação integrada', 'FEED_IMAGE', 'SCHEDULED', 'FIXED', 0, 'SELECTED', ${actorId})
    RETURNING id
  `;
  await sql`
    INSERT INTO campaign_media (campaign_id, media_asset_id, position) VALUES (${campaign.id}, ${asset.id}, 0)
  `;
  const [job] = await sql<{ id: string }[]>`
    INSERT INTO publication_jobs (campaign_id, instagram_account_id, scheduled_at)
    VALUES (${campaign.id}, ${account.id}, now() - interval '1 minute')
    RETURNING id
  `;
  return { accountId: account.id, campaignId: campaign.id, jobId: job.id };
}

afterEach(() => {
  process.env.FAKE_PROVIDER_SCENARIO = "success";
  resetEnvForTests();
  resetInstagramProviderForTests();
});

describe("pipeline persistente de publicação", () => {
  it("reutiliza o container após polling e conclui exatamente uma publicação", async () => {
    const fixture = await publishingFixture("success");
    const firstClaim = await claimJob("publisher-a");
    expect(firstClaim?.id).toBe(fixture.jobId);
    await processClaimedJob(firstClaim!, "publisher-a");

    const [waiting] = await getSqlClient()<Array<{ status: string; meta_container_id: string | null; attempt_count: number }>>`
      SELECT status, meta_container_id, attempt_count FROM publication_jobs WHERE id = ${fixture.jobId}
    `;
    expect(waiting.status).toBe("RETRY_WAIT");
    expect(waiting.meta_container_id).toMatch(/^fake_/);
    expect(waiting.attempt_count).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 600));
    await getSqlClient()`UPDATE publication_jobs SET next_attempt_at = now() WHERE id = ${fixture.jobId}`;
    const secondClaim = await claimJob("publisher-b");
    expect(secondClaim?.id).toBe(fixture.jobId);
    await processClaimedJob(secondClaim!, "publisher-b");

    const [result] = await getSqlClient()<Array<{
      status: string;
      meta_media_id: string | null;
      attempt_count: number;
      campaign_status: string;
      quota_usage: number | null;
    }>>`
      SELECT job.status, job.meta_media_id, job.attempt_count,
        campaign.status AS campaign_status, account.publishing_limit_usage AS quota_usage
      FROM publication_jobs job
      JOIN campaigns campaign ON campaign.id = job.campaign_id
      JOIN instagram_accounts account ON account.id = job.instagram_account_id
      WHERE job.id = ${fixture.jobId}
    `;
    expect(result).toMatchObject({ status: "PUBLISHED", attempt_count: 0, campaign_status: "COMPLETED", quota_usage: 4 });
    expect(result.meta_media_id).toMatch(/^fake_media_/);
    expect(await claimJob("publisher-extra")).toBeNull();
  });

  it("nunca repete automaticamente um publish de resultado ambíguo", async () => {
    const fixture = await publishingFixture("ambiguous_publish");
    const first = await claimJob("ambiguous-a");
    await processClaimedJob(first!, "ambiguous-a");
    await new Promise((resolve) => setTimeout(resolve, 600));
    await getSqlClient()`UPDATE publication_jobs SET next_attempt_at = now() WHERE id = ${fixture.jobId}`;
    const second = await claimJob("ambiguous-b");
    await processClaimedJob(second!, "ambiguous-b");

    const [job] = await getSqlClient()<Array<{ status: string; reconciliation_required: boolean; campaign_status: string }>>`
      SELECT job.status, job.reconciliation_required, campaign.status AS campaign_status
      FROM publication_jobs job JOIN campaigns campaign ON campaign.id = job.campaign_id
      WHERE job.id = ${fixture.jobId}
    `;
    expect(job).toEqual({ status: "RECONCILIATION_REQUIRED", reconciliation_required: true, campaign_status: "FAILED" });
    expect(await claimJob("ambiguous-c")).toBeNull();
  });

  it("classifica 500 como transitório e token expirado como reconexão obrigatória", async () => {
    const transient = await publishingFixture("http_500");
    const transientClaim = await claimJob("transient");
    await processClaimedJob(transientClaim!, "transient");
    const [retry] = await getSqlClient()<Array<{ status: string; attempt_count: number; last_error_type: string }>>`
      SELECT status, attempt_count, last_error_type FROM publication_jobs WHERE id = ${transient.jobId}
    `;
    expect(retry).toEqual({ status: "RETRY_WAIT", attempt_count: 1, last_error_type: "TRANSIENT" });

    const expired = await publishingFixture("token_expired");
    const expiredClaim = await claimJob("expired");
    await processClaimedJob(expiredClaim!, "expired");
    const [auth] = await getSqlClient()<Array<{ job_status: string; account_status: string; last_error_type: string }>>`
      SELECT job.status AS job_status, account.status AS account_status, job.last_error_type
      FROM publication_jobs job JOIN instagram_accounts account ON account.id = job.instagram_account_id
      WHERE job.id = ${expired.jobId}
    `;
    expect(auth).toEqual({ job_status: "FAILED", account_status: "REAUTH_REQUIRED", last_error_type: "AUTH" });
  });

  it("classifica HTTP 501 como transitório e agenda retry limitado", async () => {
    const fixture = await publishingFixture("http_501");
    const claim = await claimJob("not-implemented");
    await processClaimedJob(claim!, "not-implemented");
    const [job] = await getSqlClient()<Array<{
      status: string;
      attempt_count: number;
      last_error_code: string;
      last_http_status: number;
    }>>`
      SELECT status, attempt_count, last_error_code, last_http_status
      FROM publication_jobs WHERE id = ${fixture.jobId}
    `;
    expect(job).toEqual({ status: "RETRY_WAIT", attempt_count: 1, last_error_code: "FAKE_501", last_http_status: 501 });
  });

  it("mantém quota esgotada em RETRY_WAIT sem consumir tentativas nem criar container", async () => {
    const fixture = await publishingFixture("success", { usage: 50, total: 50 });
    const claim = await claimJob("quota");
    await processClaimedJob(claim!, "quota");
    const [job] = await getSqlClient()<Array<{
      status: string;
      attempt_count: number;
      meta_container_id: string | null;
      last_error_code: string;
    }>>`
      SELECT status, attempt_count, meta_container_id, last_error_code
      FROM publication_jobs WHERE id = ${fixture.jobId}
    `;
    expect(job).toEqual({
      status: "RETRY_WAIT",
      attempt_count: 0,
      meta_container_id: null,
      last_error_code: "PUBLISHING_LIMIT",
    });

    await getSqlClient()`
      UPDATE instagram_accounts SET publishing_limit_usage = 49, publishing_limit_total = 50,
        publishing_limit_checked_at = now()
      WHERE id = ${fixture.accountId}
    `;
    await getSqlClient()`UPDATE publication_jobs SET next_attempt_at = now() WHERE id = ${fixture.jobId}`;
    const releasedClaim = await claimJob("quota-released");
    await processClaimedJob(releasedClaim!, "quota-released");
    const [afterRelease] = await getSqlClient()<Array<{
      status: string;
      last_error_code: string | null;
      has_container_deadline: boolean;
    }>>`
      SELECT status, last_error_code, container_started_at IS NOT NULL AS has_container_deadline
      FROM publication_jobs WHERE id = ${fixture.jobId}
    `;
    expect(afterRelease).toEqual({ status: "RETRY_WAIT", last_error_code: null, has_container_deadline: true });
  });

  it("encerra container preso em processamento em vez de fazer polling infinito", async () => {
    const fixture = await publishingFixture("success");
    const stuckContainer = `fake_${Buffer.from(JSON.stringify({
      id: crypto.randomUUID(),
      readyAt: Date.now() + 24 * 60 * 60 * 1000,
    })).toString("base64url")}`;
    await getSqlClient()`
      UPDATE publication_jobs SET meta_container_id = ${stuckContainer}, status = 'QUEUED',
        container_started_at = now() - interval '2 hours'
      WHERE id = ${fixture.jobId}
    `;
    const claim = await claimJob("stuck-container");
    await processClaimedJob(claim!, "stuck-container");

    const [job] = await getSqlClient()<Array<{ status: string; last_error_code: string }>>`
      SELECT status, last_error_code FROM publication_jobs WHERE id = ${fixture.jobId}
    `;
    expect(job).toEqual({ status: "FAILED", last_error_code: "CONTAINER_PROCESSING_TIMEOUT" });
  });
});
