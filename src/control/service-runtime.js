import { ServiceLease } from "../core/service-lease.js";

export class AideServiceRuntime {
  constructor({ control, lease, heartbeatMs }) {
    this.control = control;
    this.lease = lease;
    this.heartbeatMs = heartbeatMs;
    this.heartbeat = null;
    this.lostError = null;
    this.abortController = new AbortController();
    this.jobs = new Map();
    this.operations = new Set();
    this.enqueues = new Map();
  }

  static async start({ control, leasePath, ttlMs = 15_000, heartbeatMs = 5_000, leaseOptions = {} } = {}) {
    if (!control || typeof control.submit !== "function") throw new TypeError("AIDE service requires AideControl.");
    if (!Number.isInteger(heartbeatMs) || heartbeatMs <= 0 || heartbeatMs >= ttlMs) throw new TypeError("heartbeatMs must be positive and lower than ttlMs.");
    const lease = await ServiceLease.acquire({ leasePath, ttlMs, ...leaseOptions });
    const runtime = new AideServiceRuntime({ control, lease, heartbeatMs });
    runtime.#startHeartbeat();
    return runtime;
  }

  async stop() {
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(Object.assign(new Error("AIDE service stopped."), { code: "SERVICE_RUNTIME_ABORTED" }));
    }
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const pending = [
      ...this.operations,
      ...[...this.jobs.values()].filter((job) => job.state === "running" && job.promise).map((job) => job.promise),
    ];
    if (pending.length > 0) await Promise.allSettled(pending);
    this.control.closeProviderAuth?.();
    await this.lease.release();
  }

  async health() {
    await this.#assertLive();
    return { ok: true, owner_id: this.lease.ownerId, jobs: [...this.jobs.values()].filter((job) => job.state === "running").length };
  }

  async submit(message, options = {}) {
    await this.#assertLive();
    return this.#track(this.control.submit(message, { ...options, signal: this.abortController.signal }));
  }
  async preflight(message, options = {}) {
    await this.#assertLive();
    return this.control.preflight(message, options);
  }
  async enqueue(message, options = {}, { clientRequestId = null } = {}) {
    if (clientRequestId !== null) {
      if (typeof clientRequestId !== "string" || clientRequestId.trim().length === 0 || clientRequestId.length > 256) throw new TypeError("clientRequestId must be a non-empty string up to 256 characters.");
      const pending = this.enqueues.get(clientRequestId);
      if (pending) return pending;
      const operation = (async () => {
        await this.#assertLive();
        return this.#enqueue(message, options, clientRequestId);
      })();
      this.enqueues.set(clientRequestId, operation);
      try { return await operation; }
      finally { this.enqueues.delete(clientRequestId); }
    }
    await this.#assertLive();
    return this.#enqueue(message, options, null);
  }

  async #enqueue(message, options, clientRequestId) {
    const started = await this.control.startTask(message, { ...options, clientRequestId, signal: this.abortController.signal });
    const taskId = started.task.task_id;
    const attemptId = started.attempt?.attempt_id ?? null;
    if (started.supervision_required === false) {
      const existingJob = this.jobs.get(taskId);
      return {
        task_id: taskId,
        attempt_id: attemptId,
        state: existingJob?.state === "running" ? "running" : started.state,
        idempotent_replay: true,
        recovery_required: started.recovery_required === true,
      };
    }
    const job = { task_id: taskId, attempt_id: attemptId, state: "running", result: null, error: null };
    this.jobs.set(taskId, job);
    job.promise = this.control.driveTask(attemptId, { ...options, signal: this.abortController.signal })
      .then((result) => { job.state = "completed"; job.result = result; })
      .catch((error) => {
        job.state = error?.code === "SERVICE_RUNTIME_ABORTED" ? "detached" : "failed";
        job.error = { code: error?.code ?? "AIDE_SERVICE_JOB_FAILED", message: error?.message ?? "AIDE service job failed." };
      });
    return { task_id: taskId, attempt_id: attemptId, state: "running", idempotent_replay: started.idempotent_replay === true };
  }
  async status(taskId) {
    await this.#assertLive();
    const status = await this.control.status(taskId);
    const job = this.jobs.get(taskId);
    return {
      ...status,
      service_job: job ? { state: job.state, error: job.error } : null,
    };
  }
  async recoveries(...args) { await this.#assertLive(); return this.control.recoveries(...args); }
  async routingHistory(...args) { await this.#assertLive(); return this.control.routingHistory(...args); }
  async createConversation(...args) { await this.#assertLive(); return this.control.createConversation(...args); }
  async updateConversation(...args) { await this.#assertLive(); return this.control.updateConversation(...args); }
  async conversations(...args) { await this.#assertLive(); return this.control.conversations(...args); }
  async conversation(...args) { await this.#assertLive(); return this.control.conversation(...args); }
  async tasks(...args) { await this.#assertLive(); return this.control.tasks(...args); }
  async catalog(...args) { await this.#assertLive(); return this.control.catalog(...args); }
  async providerLogin(...args) { await this.#assertLive(); return this.control.providerLogin(...args); }
  async providerLoginStatus(...args) { await this.#assertLive(); return this.control.providerLoginStatus(...args); }
  async providerLoginCancel(...args) { await this.#assertLive(); return this.control.providerLoginCancel(...args); }
  async providerLogout(...args) { await this.#assertLive(); return this.control.providerLogout(...args); }
  async recoverTask(taskId, recovery = {}) {
    await this.#assertLive();
    return this.#track(this.control.recoverTask(taskId, { ...recovery, signal: this.abortController.signal }));
  }
  async observe(...args) { await this.#assertLive(); return this.control.observe(...args); }
  async respond(interactionId, response, options = {}) {
    await this.#assertLive();
    return this.#track(this.control.respond(interactionId, response, { ...options, signal: this.abortController.signal }));
  }
  async steer(...args) { await this.#assertLive(); return this.control.steer(...args); }
  async steerTask(...args) { await this.#assertLive(); return this.control.steerTask(...args); }
  async cancel(...args) { await this.#assertLive(); return this.control.cancel(...args); }
  async cancelTask(...args) { await this.#assertLive(); return this.control.cancelTask(...args); }

  #startHeartbeat() {
    this.heartbeat = setInterval(() => {
      void this.lease.renew().catch((error) => {
        this.lostError = error;
        if (!this.abortController.signal.aborted) this.abortController.abort(error);
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
      });
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
  }

  async #assertLive() {
    if (this.lostError) throw this.lostError;
    await this.lease.assertOwner();
  }

  #track(promise) {
    const tracked = Promise.resolve(promise);
    this.operations.add(tracked);
    void tracked.then(
      () => this.operations.delete(tracked),
      () => this.operations.delete(tracked),
    );
    return tracked;
  }
}
