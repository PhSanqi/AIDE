export function evaluateAcceptance({ result, evidence, criteria = {} } = {}) {
  const checks = [];
  const check = (name, passed, actual = undefined, expected = undefined) => checks.push({ name, passed, ...(actual === undefined ? {} : { actual }), ...(expected === undefined ? {} : { expected }) });

  check("harness_completed", result?.status === "completed", result?.status ?? null, "completed");
  if (criteria.finalText !== undefined) check("final_text", result?.final_text === criteria.finalText, result?.final_text ?? null, criteria.finalText);

  const files = new Map((evidence?.files ?? []).map((file) => [file.path, file]));
  for (const [path, expectedText] of Object.entries(criteria.files ?? {})) {
    const file = files.get(path);
    check(`file:${path}:exists`, Boolean(file), Boolean(file), true);
    if (file) check(`file:${path}:text`, file.text === expectedText, file.text, expectedText);
  }

  return { accepted: checks.every((item) => item.passed), checks };
}
