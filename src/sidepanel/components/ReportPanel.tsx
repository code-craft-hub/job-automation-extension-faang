import type { SubmitResult } from "../lib/types";
import { renderReport } from "../lib/report";

interface Props {
  result: SubmitResult;
}

export function ReportPanel({ result }: Props) {
  return (
    <div className="sp-report">
      <div className="sp-report-header">
        <span className="sp-report-icon">✓</span>
        <span className="sp-report-title">Application Report</span>
        <span className="sp-report-stat">
          {result.filled} fields filled
        </span>
      </div>
      <pre className="sp-report-body">{renderReport(result)}</pre>
    </div>
  );
}
