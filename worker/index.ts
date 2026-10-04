import { randomUUID } from "node:crypto";
import { closeDatabase, getSqlClient } from "../src/db/client";
import { getEnv } from "../src/lib/env";
import { log } from "../src/lib/logger";
import { claimAutoComment, claimJob, processClaimedAutoComment, processClaimedJob, recoverStaleJobs } from "../src/jobs/queue";
import { refreshExpiringTokens } from "../src/jobs/token-maintenance";
import { runInsightsSync } from "../src/jobs/insights-sync";
import { reconcileActiveLoops } from "../src/server/automation";

const workerId = `${process.env.HOSTNAME ?? "worker"}-${process.pid}-${randomUUID().slice(0, 8)}`;
let stopping = false;
let activeJobs = 0;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function heartbeat() {
  await getSqlClient()`
    INSERT INTO worker_heartbeats (worker_id, started_at, last_seen_at, active_jobs, version)
    VALUES (${workerId}, now(), now(), ${activeJobs}, ${process.env.npm_package_version ?? "unknown"})
    ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now(), active_jobs = ${activeJobs}, version = EXCLUDED.version
  `;
}

function createMaintenanceTask(event: string, operation: () => Promise<unknown>) {
  let inFlight: Promise<void> | undefined;
  return {
    trigger() {
      if (stopping) return Promise.resolve();
      if (!inFlight) {
        inFlight = operation()
          .then(() => undefined)
          .catch((error: unknown) => {
            log("error", "worker", event, {
              worker_id: workerId,
              error: error instanceof Error ? error.message : "unknown",
            });
          })
          .finally(() => {
            inFlight = undefined;
          });
      }
      return inFlight;
    },
    wait() {
      return inFlight ?? Promise.resolve();
    },
  };
}

async function runner() {
  let preferComment = false;
  while (!stopping) {
    try {
      const comment = preferComment ? await claimAutoComment(workerId) : null;
      const job = comment ? null : await claimJob(workerId);
      const fallbackComment = !comment && !job ? await claimAutoComment(workerId) : null;
      const claimedComment = comment ?? fallbackComment;
      if (!job && !claimedComment) {
        await wait(getEnv().WORKER_POLL_MS);
        continue;
      }
      preferComment = !preferComment;
      if (claimedComment) {
        activeJobs++;
        try {
          await processClaimedAutoComment(claimedComment, workerId);
        } finally {
          activeJobs--;
        }
        continue;
      }
      activeJobs++;
      try {
        await processClaimedJob(job!, workerId);
      } finally {
        activeJobs--;
      }
    } catch (error) {
      log("error", "worker", "runner_failed", {
        worker_id: workerId,
        error: error instanceof Error ? error.message : "unknown",
      });
      if (!stopping) await wait(Math.min(getEnv().WORKER_POLL_MS, 5_000));
    }
  }
}

async function main() {
  const env = getEnv();
  const recovered = await recoverStaleJobs();
  const reconciledLoops = await reconcileActiveLoops();
  log("info", "worker", "started", {
    worker_id: workerId,
    concurrency: env.WORKER_CONCURRENCY,
    recovered,
    reconciled_loops: reconciledLoops,
  });
  const heartbeatTask = createMaintenanceTask("heartbeat_failed", heartbeat);
  const tokenTask = createMaintenanceTask("token_maintenance_failed", () => refreshExpiringTokens(workerId));
  const recoveryTask = createMaintenanceTask("recovery_failed", async () => ({
    recovered: await recoverStaleJobs(),
    reconciledLoops: await reconcileActiveLoops(),
  }));
  const insightsTask = createMaintenanceTask("insights_sync_failed", () => runInsightsSync(workerId));
  await heartbeatTask.trigger();
  const heartbeatTimer = setInterval(() => void heartbeatTask.trigger(), 10_000);
  const tokenTimer = setInterval(
    () => void tokenTask.trigger(),
    60 * 60 * 1000,
  );
  const recoveryTimer = setInterval(
    () => void recoveryTask.trigger(),
    30_000,
  );
  const insightsTimer = setInterval(() => void insightsTask.trigger(), 60_000);
  void tokenTask.trigger();
  void insightsTask.trigger();

  const shutdown = () => {
    stopping = true;
    clearInterval(heartbeatTimer);
    clearInterval(tokenTimer);
    clearInterval(recoveryTimer);
    clearInterval(insightsTimer);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await Promise.all(Array.from({ length: env.WORKER_CONCURRENCY }, runner));
  await Promise.all([heartbeatTask.wait(), tokenTask.wait(), recoveryTask.wait(), insightsTask.wait()]);
  await getSqlClient()`DELETE FROM worker_heartbeats WHERE worker_id = ${workerId}`;
  await closeDatabase();
  log("info", "worker", "stopped", { worker_id: workerId });
}

main().catch(async (error) => {
  log("error", "worker", "fatal", { worker_id: workerId, error: error instanceof Error ? error.message : "unknown" });
  await closeDatabase();
  process.exitCode = 1;
});
