import type { Phase } from "../lib/types";

interface Props {
  jobInfo: { title: string; company: string } | null;
  phase: Phase;
}

const BADGE: Record<Phase, { label: string; cls: string }> = {
  idle:    { label: "WAITING",  cls: "sp-job-pill--idle" },
  running: { label: "APPLYING", cls: "sp-job-pill--running" },
  done:    { label: "DONE",     cls: "sp-job-pill--done" },
  error:   { label: "ERROR",    cls: "sp-job-pill--error" },
};

export function JobCard({ jobInfo, phase }: Props) {
  const pill = BADGE[phase];
  const initials = jobInfo
    ? jobInfo.title.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    : "CV";

  return (
    <div className="sp-job-card">
      <div className="sp-job-row">
        <div className="sp-company-avatar">{initials}</div>
        <div className="sp-job-info">
          <div className="sp-job-title">
            {jobInfo ? jobInfo.title : "No job selected"}
          </div>
          {jobInfo?.company && (
            <div className="sp-job-company">{jobInfo.company}</div>
          )}
        </div>
        <span className={`sp-job-pill ${pill.cls}`}>{pill.label}</span>
      </div>
    </div>
  );
}
