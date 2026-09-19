import { randomUUID } from "node:crypto";
import { hostname as systemHostname } from "node:os";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

function leaseError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

async function writeMetadata(leasePath, metadata) {
  const target = join(leasePath, "owner.json");
  const temporary = join(leasePath, `.owner-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

async function readMetadata(leasePath) {
  try {
    return JSON.parse(await readFile(join(leasePath, "owner.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return null;
  }
}

function localProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export class ServiceLease {
  constructor({ leasePath, ownerId, hostname, pid, ttlMs, now, processAlive }) {
    this.leasePath = leasePath;
    this.ownerId = ownerId;
    this.hostname = hostname;
    this.pid = pid;
    this.ttlMs = ttlMs;
    this.now = now;
    this.processAlive = processAlive;
    this.released = false;
  }

  static async acquire({
    leasePath,
    ownerId = randomUUID(),
    hostname = systemHostname(),
    pid = process.pid,
    ttlMs = 15_000,
    now = () => Date.now(),
    processAlive = localProcessAlive,
  } = {}) {
    if (typeof leasePath !== "string" || leasePath.length === 0) throw new TypeError("leasePath is required.");
    if (typeof ownerId !== "string" || ownerId.length === 0) throw new TypeError("ownerId is required.");
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000) throw new TypeError("ttlMs must be at least 1000ms.");
    const lease = new ServiceLease({ leasePath, ownerId, hostname, pid, ttlMs, now, processAlive });
    await lease.#acquire();
    return lease;
  }

  async renew() {
    if (this.released) throw leaseError("SERVICE_LEASE_RELEASED", "Service lease has already been released.");
    const current = await readMetadata(this.leasePath);
    if (!current || current.owner_id !== this.ownerId) {
      throw leaseError("SERVICE_LEASE_LOST", "Service lease is no longer owned by this process.", { current_owner: current?.owner_id ?? null });
    }
    const now = this.now();
    const instant = new Date(now);
    await utimes(this.leasePath, instant, instant);
    return { ...current, renewed_at: now, expires_at: now + this.ttlMs };
  }

  async assertOwner() {
    if (this.released) throw leaseError("SERVICE_LEASE_RELEASED", "Service lease has already been released.");
    const [current, info] = await Promise.all([readMetadata(this.leasePath), stat(this.leasePath)]);
    if (!current || current.owner_id !== this.ownerId || info.mtimeMs + this.ttlMs <= this.now()) {
      throw leaseError("SERVICE_LEASE_LOST", "Service lease ownership or freshness check failed.", { current_owner: current?.owner_id ?? null });
    }
    return { ...current, renewed_at: info.mtimeMs, expires_at: info.mtimeMs + this.ttlMs };
  }

  async release() {
    if (this.released) return;
    try {
      await this.assertOwner();
      await rm(this.leasePath, { recursive: true, force: true });
    } catch (error) {
      if (!["SERVICE_LEASE_LOST", "SERVICE_LEASE_RELEASED", "ENOENT"].includes(error?.code)) throw error;
    }
    this.released = true;
  }

  #metadata() {
    const now = this.now();
    return {
      owner_id: this.ownerId,
      hostname: this.hostname,
      pid: this.pid,
      acquired_at: now,
    };
  }

  async #acquire() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await mkdir(this.leasePath, { mode: 0o700 });
        await writeMetadata(this.leasePath, this.#metadata());
        const instant = new Date(this.now());
        await utimes(this.leasePath, instant, instant);
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }

      const current = await readMetadata(this.leasePath);
      const info = await stat(this.leasePath);
      const stale = info.mtimeMs + this.ttlMs <= this.now();
      if (!stale || (current?.hostname === this.hostname && this.processAlive(current.pid))) {
        throw leaseError("SERVICE_LEASE_BUSY", "Another AIDE service instance owns the project lease.", {
          current_owner: current?.owner_id ?? null,
          current_pid: current?.pid ?? null,
          current_hostname: current?.hostname ?? null,
        });
      }

      const stalePath = `${this.leasePath}.stale-${randomUUID()}`;
      try {
        await rename(this.leasePath, stalePath);
        await rm(stalePath, { recursive: true, force: true });
      } catch (error) {
        if (!["ENOENT", "EEXIST"].includes(error?.code)) throw error;
      }
    }
    throw leaseError("SERVICE_LEASE_BUSY", "Unable to acquire AIDE service lease after concurrent takeover attempts.");
  }
}
