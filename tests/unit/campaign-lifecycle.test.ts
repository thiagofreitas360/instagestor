import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  queries: [] as Array<{ text: string; values: unknown[] }>,
  responses: [] as unknown[],
}));

vi.mock("@/db/client", () => {
  const sql = (...args: unknown[]) => {
    const strings = args[0] as TemplateStringsArray;
    database.queries.push({ text: strings.join("?"), values: args.slice(1) });
    return Promise.resolve(database.responses.shift() ?? []);
  };
  Object.assign(sql, {
    begin: async (callback: (transaction: typeof sql) => unknown) => callback(sql),
  });
  return { getSqlClient: () => sql };
});

import {
  cancelCampaign,
  duplicateCampaign,
  pauseCampaign,
  resumeCampaign,
  retryFailedJob,
} from "@/server/scheduler";

beforeEach(() => {
  database.queries.length = 0;
  database.responses.length = 0;
});

describe("ciclo operacional de campanha", () => {
  it("pausa somente campanha agendada/em execução e registra auditoria", async () => {
    database.responses.push([{ id: "campaign-1" }], []);

    await pauseCampaign("campaign-1", "admin-1");

    expect(database.queries[0].text).toContain("status IN ('SCHEDULED', 'RUNNING')");
    expect(database.queries[1].text).toContain("'CAMPAIGN_PAUSED'");
    expect(database.queries[1].values).toEqual(["admin-1", "campaign-1"]);
  });

  it("recusa pausa quando a atualização condicional não encontra campanha", async () => {
    database.responses.push([]);

    await expect(pauseCampaign("campaign-finalizada", "admin-1")).rejects.toThrow("não pode ser pausada");
    expect(database.queries).toHaveLength(1);
  });

  it("retoma apenas PAUSED e deixa jobs vencidos elegíveis imediatamente", async () => {
    database.responses.push([{ id: "campaign-1" }], []);

    await resumeCampaign("campaign-1", "admin-1");

    expect(database.queries[0].text).toContain("status = 'PAUSED'");
    expect(database.queries[1].text).toContain("'CAMPAIGN_RESUMED'");
    expect(database.queries[1].values.at(-1)).toContain('"overdue":"eligible_immediately"');
  });

  it("cancela somente jobs ainda não iniciados e não toca publicação em andamento", async () => {
    database.responses.push([{ id: "campaign-1" }], [], []);

    await cancelCampaign("campaign-1", "admin-1");

    expect(database.queries[1].text).toContain("status IN ('QUEUED', 'RETRY_WAIT')");
    expect(database.queries[1].text).not.toContain("PUBLISHING");
    expect(database.queries[2].text).toContain("'CAMPAIGN_CANCELLED'");
  });

  it("retry manual limpa container, erro e lock antes de reenfileirar", async () => {
    database.responses.push([{ id: "job-1", campaign_id: "campaign-1" }], [], []);

    await retryFailedJob("job-1", "admin-1");

    const retryQuery = database.queries[0].text;
    expect(retryQuery).toContain("status = 'QUEUED'");
    expect(retryQuery).toContain("meta_container_id = NULL");
    expect(retryQuery).toContain("meta_child_container_ids = NULL");
    expect(retryQuery).toContain("WHERE job.id = ? AND job.status = 'FAILED'");
    expect(retryQuery).toContain("campaign.status <> 'CANCELLED'");
    expect(database.queries[1].text).toContain("status IN ('FAILED', 'PARTIALLY_FAILED')");
    expect(database.queries[2].text).toContain("'JOB_MANUAL_RETRY'");
  });

  it("duplica conteúdo e destinos em um novo rascunho, sem copiar jobs", async () => {
    database.responses.push([{ id: "campaign-copy" }], [], []);

    await expect(duplicateCampaign("campaign-original", "admin-1")).resolves.toBe("campaign-copy");

    expect(database.queries[0].text).toContain("'DRAFT'");
    expect(database.queries[1].text).toContain("INSERT INTO campaign_media");
    expect(database.queries[2].text).toContain("INSERT INTO campaign_targets");
    expect(database.queries.every((query) => !query.text.includes("publication_jobs"))).toBe(true);
  });
});
