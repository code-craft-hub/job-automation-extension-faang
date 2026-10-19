import type { SubmitResult } from "./types";

export function renderReport(result: SubmitResult): string {
  const lines = [
    "── SUBMIT REPORT ─────────────────────────────",
    `Page:      ${result.title}`,
    `URL:       ${result.url}`,
    `Submitted: ${result.submitted ? "YES ✓" : result.pageAction === "continued" ? "CONTINUED →" : "NO (submit button not found)"}`,
    `Filled:    ${result.filled}/${result.report.length} fields`,
    "",
  ];

  const filled = result.report.filter((r) => r.status === "filled");
  const notFilled = result.report.filter((r) => r.status !== "filled");

  if (filled.length > 0) {
    lines.push(`── FILLED FIELDS (${filled.length}) ─────────────────────`);
    for (const r of filled) {
      const tag = r.source === "ai_generated" ? "[AI]   " : "[demo] ";
      const val = r.value.length > 60 ? r.value.slice(0, 57) + "..." : r.value;
      lines.push(`  ${tag} "${r.label}" → "${val}"`);
    }
    lines.push("");
  }

  if (notFilled.length > 0) {
    lines.push(`── NOT FILLED (${notFilled.length}) ──────────────────────────`);
    for (const r of notFilled) {
      lines.push(`  [${r.status}] "${r.label}"`);
    }
  }

  return lines.join("\n");
}
