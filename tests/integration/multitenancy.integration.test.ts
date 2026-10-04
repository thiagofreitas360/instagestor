import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSqlClient } from "@/db/client";
import { resolveTargetIds } from "@/server/campaigns";
import { loadAnalytics, resolvePeriod } from "@/server/analytics";
import { pauseCampaign } from "@/server/scheduler";
import {
  createAccounts,
  createCampaign,
  createOrganization,
  createUser,
  TEST_ORGANIZATION_ID,
} from "./helpers";

describe("isolamento multitenant", () => {
  it("filtra leituras e mutações pela organização da sessão", async () => {
    const otherOrganizationId = await createOrganization(randomUUID(), "Cliente B", `cliente-b-${randomUUID()}`);
    const userA = await createUser("owner-a@example.test", TEST_ORGANIZATION_ID);
    const userB = await createUser("owner-b@example.test", otherOrganizationId);
    const [accountA] = await createAccounts(1, "tenant_a", TEST_ORGANIZATION_ID);
    const [accountB] = await createAccounts(1, "tenant_b", otherOrganizationId);
    const campaignB = await createCampaign(userB, "SCHEDULED", "Campanha B", otherOrganizationId);

    await expect(resolveTargetIds({
      organizationId: TEST_ORGANIZATION_ID,
      accountIds: [accountA.id, accountB.id],
    })).resolves.toEqual([accountA.id]);

    await expect(pauseCampaign(campaignB, userA, TEST_ORGANIZATION_ID)).rejects.toThrow("não pode ser pausada");
    const [unchanged] = await getSqlClient()<Array<{ status: string }>>`
      SELECT status FROM campaigns WHERE organization_id = ${otherOrganizationId} AND id = ${campaignB}
    `;
    expect(unchanged.status).toBe("SCHEDULED");

    await getSqlClient()`
      INSERT INTO account_daily_metrics (organization_id, instagram_account_id, day, followers_count, reach)
      VALUES
        (${TEST_ORGANIZATION_ID}, ${accountA.id}, current_date, 100, 10),
        (${otherOrganizationId}, ${accountB.id}, current_date, 900, 90)
    `;
    const analyticsA = await loadAnalytics({
      organizationId: TEST_ORGANIZATION_ID,
      accountIds: null,
      period: resolvePeriod(7),
    });
    expect(analyticsA.totals.followers).toBe(100);
    expect(analyticsA.totals.reach).toBe(10);
    expect(analyticsA.ranking.map((account) => account.id)).toEqual([accountA.id]);
  });

  it("o banco rejeita relações entre registros de organizações diferentes", async () => {
    const otherOrganizationId = await createOrganization(randomUUID(), "Cliente B", `cliente-b-${randomUUID()}`);
    const userA = await createUser("db-owner-a@example.test", TEST_ORGANIZATION_ID);
    await createUser("db-owner-b@example.test", otherOrganizationId);
    const [accountB] = await createAccounts(1, "cross_tenant", otherOrganizationId);
    const campaignA = await createCampaign(userA, "DRAFT", "Campanha A", TEST_ORGANIZATION_ID);

    await expect(getSqlClient()`
      INSERT INTO campaign_targets (organization_id, campaign_id, instagram_account_id, position)
      VALUES (${TEST_ORGANIZATION_ID}, ${campaignA}, ${accountB.id}, 0)
    `).rejects.toMatchObject({ code: "23503" });
  });
});
