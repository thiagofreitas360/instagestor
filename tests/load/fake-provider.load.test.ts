import { describe, expect, it, vi } from "vitest";
import { FakeInstagramProvider } from "@/providers/fake-instagram";

async function publishBatch(size: number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
  const provider = new FakeInstagramProvider("success");

  const jobs = Array.from({ length: size }, (_, index) => ({
    campaignId: `campaign-${Math.floor(index / 50)}`,
    jobId: `campaign-${Math.floor(index / 50)}-account-${index % 50}`,
    accountId: `account-${index % 50}`,
    accessToken: `fake-token:${index % 50}:conta_${index % 50}`,
    mediaUrl: `https://storage.test/media-${index}.jpg`,
  }));
  const containers = await Promise.all(
    jobs.map((job) =>
      provider.createMediaContainer({
        accountId: job.accountId,
        accessToken: job.accessToken,
        publicationType: "FEED_IMAGE",
        mediaUrls: [job.mediaUrl],
      }),
    ),
  );
  vi.advanceTimersByTime(500);

  const statuses = await Promise.all(
    containers.map((container, index) => provider.getContainerStatus(container, jobs[index].accessToken)),
  );
  const published = await Promise.all(
    containers.map((container, index) =>
      provider.publishContainer(jobs[index].accountId, container, jobs[index].accessToken),
    ),
  );
  const redelivered = await Promise.all(
    containers.map((container, index) =>
      provider.publishContainer(jobs[index].accountId, container, jobs[index].accessToken),
    ),
  );

  return { jobs, containers, statuses, published, redelivered };
}

describe.each([150, 500, 1_000])("carga FakeProvider com %i jobs", (size) => {
  it("distribui campanhas por 50 contas, não perde jobs e tolera reentrega idempotente", async () => {
    const result = await publishBatch(size);

    expect(result.jobs).toHaveLength(size);
    expect(new Set(result.jobs.map((job) => job.accountId)).size).toBe(50);
    expect(new Set(result.jobs.map((job) => job.campaignId)).size).toBe(size / 50);
    expect(new Set(result.jobs.map((job) => job.jobId)).size).toBe(size);
    expect(result.containers).toHaveLength(size);
    expect(new Set(result.containers).size).toBe(size);
    expect(result.statuses).toEqual(Array.from({ length: size }, () => "FINISHED"));
    expect(result.published).toHaveLength(size);
    expect(new Set(result.published).size).toBe(size);
    expect(result.redelivered).toEqual(result.published);
  });
});
