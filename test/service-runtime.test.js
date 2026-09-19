import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import { ServiceLease } from "../src/core/service-lease.js";
import { AideServiceRuntime } from "../src/control/service-runtime.js";

test("ServiceLease allows one owner and releases for the next service", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-service-lease-"));
  const leasePath = join(root, "service.lease");
  const first = await ServiceLease.acquire({ leasePath, ownerId: "first", ttlMs: 5_000 });
  await assert.rejects(ServiceLease.acquire({ leasePath, ownerId: "second", ttlMs: 5_000 }), (error) => error.code === "SERVICE_LEASE_BUSY");
  await first.release();
  const second = await ServiceLease.acquire({ leasePath, ownerId: "second", ttlMs: 5_000 });
  assert.equal((await second.assertOwner()).owner_id, "second");
  await second.release();
});

test("ServiceLease can take over an expired dead owner but not an expired live local owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-service-stale-"));
  const leasePath = join(root, "service.lease");
  await mkdir(leasePath);
  await writeFile(join(leasePath, "owner.json"), JSON.stringify({ owner_id: "old", hostname: "host", pid: 77, acquired_at: Date.now() }));
  const staleNow = Date.now() + 10_000;

  await assert.rejects(
    ServiceLease.acquire({ leasePath, ownerId: "new", hostname: "host", pid: 88, ttlMs: 5_000, now: () => staleNow, processAlive: () => true }),
    (error) => error.code === "SERVICE_LEASE_BUSY",
  );
  const replacement = await ServiceLease.acquire({ leasePath, ownerId: "new", hostname: "host", pid: 88, ttlMs: 5_000, now: () => staleNow, processAlive: () => false });
  assert.equal((await replacement.assertOwner()).owner_id, "new");
  await firstExpiredReleaseDoesNotRemoveReplacement();
  await replacement.release();

  async function firstExpiredReleaseDoesNotRemoveReplacement() {
    const old = new ServiceLease({ leasePath, ownerId: "old", hostname: "host", pid: 77, ttlMs: 5_000, now: () => staleNow, processAlive: () => false });
    await old.release();
    assert.equal((await replacement.assertOwner()).owner_id, "new");
  }
});

test("AideServiceRuntime refuses control calls after losing its lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-service-runtime-"));
  const leasePath = join(root, "service.lease");
  const control = { submit: async (message) => ({ message }) };
  const runtime = await AideServiceRuntime.start({ control, leasePath, ttlMs: 5_000, heartbeatMs: 1_000 });
  assert.deepEqual(await runtime.submit("work"), { message: "work" });

  await runtime.lease.release();
  await assert.rejects(runtime.submit("must fail"), (error) => ["SERVICE_LEASE_RELEASED", "SERVICE_LEASE_LOST"].includes(error.code));
  await runtime.stop();
});

test("AideServiceRuntime exposes bounded routing history through the live service lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-service-routing-history-"));
  const leasePath = join(root, "service.lease");
  const control = {
    submit: async () => ({ state: "terminal" }),
    routingHistory: (options) => [{ attempt_id: "attempt-history", limit: options.limit }],
  };
  const runtime = await AideServiceRuntime.start({ control, leasePath, ttlMs: 5_000, heartbeatMs: 1_000 });
  assert.deepEqual(await runtime.routingHistory({ limit: 7 }), [{ attempt_id: "attempt-history", limit: 7 }]);
  await runtime.stop();
});

test("AideServiceRuntime enqueue returns Task identity before background supervision completes", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-service-enqueue-"));
  const leasePath = join(root, "service.lease");
  let finish;
  const control = {
    submit: async () => ({ state: "terminal" }),
    startTask: async () => ({ task: { task_id: "task-bg" }, attempt: { attempt_id: "attempt-bg" } }),
    driveTask: async (_attemptId, { signal }) => new Promise((resolve, reject) => {
      finish = resolve;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    status: async (taskId) => ({ task: { task_id: taskId }, runtime: { attached: true } }),
  };
  const runtime = await AideServiceRuntime.start({ control, leasePath, ttlMs: 5_000, heartbeatMs: 1_000 });

  const accepted = await runtime.enqueue("background work");
  assert.deepEqual(accepted, { task_id: "task-bg", attempt_id: "attempt-bg", state: "running", idempotent_replay: false });
  assert.equal((await runtime.status("task-bg")).service_job.state, "running");

  finish({ state: "terminal", automation: { status: "completed" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await runtime.status("task-bg")).service_job.state, "completed");
  await runtime.stop();
});

test("AideServiceRuntime stop aborts detached background supervision", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-service-abort-"));
  const leasePath = join(root, "service.lease");
  const control = {
    submit: async () => ({ state: "terminal" }),
    startTask: async () => ({ task: { task_id: "task-abort" }, attempt: { attempt_id: "attempt-abort" } }),
    driveTask: async (_attemptId, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  };
  const runtime = await AideServiceRuntime.start({ control, leasePath, ttlMs: 5_000, heartbeatMs: 1_000 });
  await runtime.enqueue("long work");
  await runtime.stop();
  assert.equal(runtime.jobs.get("task-abort").state, "detached");
});

test("AideServiceRuntime coalesces concurrent enqueue calls with one client request id", async () => {
  const root = await mkdtemp(join(tmpdir(), "aide-service-idempotent-"));
  const leasePath = join(root, "service.lease");
  let starts = 0;
  let releaseStart;
  const gate = new Promise((resolve) => { releaseStart = resolve; });
  const control = {
    submit: async () => ({ state: "terminal" }),
    startTask: async () => {
      starts += 1;
      await gate;
      return { task: { task_id: "task-once" }, attempt: { attempt_id: "attempt-once" }, supervision_required: false, state: "running", idempotent_replay: false };
    },
    status: async () => ({ task: { task_id: "task-once" } }),
  };
  const runtime = await AideServiceRuntime.start({ control, leasePath, ttlMs: 5_000, heartbeatMs: 1_000 });
  const first = runtime.enqueue("same", {}, { clientRequestId: "request-1" });
  const second = runtime.enqueue("same", {}, { clientRequestId: "request-1" });
  releaseStart();
  assert.deepEqual(await first, await second);
  assert.equal(starts, 1);
  await runtime.stop();
});
