export async function closeAcceptedTask({ store, attemptId, facts } = {}) {
  if (!store || typeof store.getAttempt !== "function" || typeof store.commitTaskClosure !== "function") {
    throw new TypeError("store must be a WorkStateStore-like object.");
  }
  const attempt = store.getAttempt(attemptId);
  if (attempt.acceptance?.accepted !== true) {
    throw Object.assign(new Error("Tutti cannot close a Task without accepted evidence."), { code: "TASK_ACCEPTANCE_REQUIRED" });
  }
  const workPackage = store.getWorkPackage(attempt.work_package_id);
  return store.commitTaskClosure({
    taskId: workPackage.task_id,
    workPackageId: workPackage.work_package_id,
    attemptId: attempt.attempt_id,
    facts,
  });
}
