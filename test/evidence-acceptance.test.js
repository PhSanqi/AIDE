import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateAcceptance } from "../src/tutti/acceptance.js";
import { collectFileEvidence } from "../src/workspace/evidence.js";

test("workspace evidence plus Tutti acceptance closes the smoke contract", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "aide-evidence-test-"));
  await writeFile(join(cwd, "SMOKE.txt"), "AIDE_DSH_SMOKE_OK");
  const evidence = await collectFileEvidence({ cwd, paths: ["SMOKE.txt"] });
  const acceptance = evaluateAcceptance({
    result: { status: "completed", final_text: "AIDE_DSH_SMOKE_OK" },
    evidence,
    criteria: { finalText: "AIDE_DSH_SMOKE_OK", files: { "SMOKE.txt": "AIDE_DSH_SMOKE_OK" } },
  });
  assert.equal(evidence.files[0].size, 17);
  assert.equal(acceptance.accepted, true);
});

test("Tutti acceptance rejects evidence that does not satisfy the task", () => {
  const acceptance = evaluateAcceptance({
    result: { status: "completed", final_text: "done" },
    evidence: { files: [{ path: "SMOKE.txt", text: "wrong" }] },
    criteria: { finalText: "AIDE_DSH_SMOKE_OK", files: { "SMOKE.txt": "AIDE_DSH_SMOKE_OK" } },
  });
  assert.equal(acceptance.accepted, false);
});

test("workspace evidence rejects lexical path escape", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "aide-evidence-path-test-"));
  await assert.rejects(() => collectFileEvidence({ cwd, paths: ["../outside.txt"] }), { code: "EVIDENCE_PATH_OUTSIDE_WORKSPACE" });
});
