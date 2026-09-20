export class AideControl {
  constructor({ intake } = {}) {
    if (!intake || typeof intake.runTask !== "function") throw new TypeError("AIDE Control requires Tutti Intake.");
    this.intake = intake;
  }

  submit(message, options = {}) {
    return this.intake.runTask(message, options);
  }

  preflight(message, options = {}) {
    return this.intake.preflight(message, options);
  }

  startTask(message, options = {}) {
    return this.intake.startRun(message, options);
  }

  driveTask(attemptId, options = {}) {
    return this.intake.driveTask(attemptId, options);
  }

  observe(attemptId, options = {}) {
    return this.intake.observeAttempt(attemptId, options);
  }

  status(taskId) {
    return this.intake.taskStatus(taskId);
  }

  recoveries() {
    return this.intake.recoveryStatus();
  }

  routingHistory(options = {}) {
    return this.intake.routingHistory(options);
  }

  createConversation(options = {}) { return this.intake.createConversation(options); }
  updateConversation(conversationId, patch = {}) { return this.intake.updateConversation(conversationId, patch); }
  conversations(options = {}) { return this.intake.conversations(options); }
  conversation(conversationId) { return this.intake.conversation(conversationId); }
  tasks(options = {}) { return this.intake.tasks(options); }
  catalog() { return this.intake.catalog(); }
  providerLogin(provider, options = {}) { return this.intake.providerLogin(provider, options); }
  providerLoginStatus(provider, loginId) { return this.intake.providerLoginStatus(provider, loginId); }
  providerLoginCancel(provider, loginId) { return this.intake.providerLoginCancel(provider, loginId); }
  providerLogout(provider) { return this.intake.providerLogout(provider); }
  closeProviderAuth() { this.intake.closeProviderAuth?.(); }

  recoverTask(taskId, recovery = {}) {
    return this.intake.recoverTask(taskId, recovery);
  }

  async respond(interactionId, response, { resolvedBy = "user", facts, timeoutMs = 120_000, cancelGraceMs = 5_000, signal } = {}) {
    const interaction = await this.intake.respondToInteraction(interactionId, response, { resolvedBy });
    const observed = await this.intake.runAttemptToBoundary(interaction.attempt_id, { facts, timeoutMs, cancelGraceMs, signal });
    const advanced = await this.intake.advanceTask(observed, { facts, timeoutMs, cancelGraceMs, signal });
    return { interaction, ...advanced };
  }

  steer(attemptId, message) {
    return this.intake.steerAttempt(attemptId, message);
  }

  steerTask(taskId, message) {
    return this.intake.steerTask(taskId, message);
  }

  cancel(attemptId) {
    return this.intake.requestCancel(attemptId);
  }

  cancelTask(taskId) {
    return this.intake.cancelTask(taskId);
  }
}
