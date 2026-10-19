import type { Phase } from "../lib/types";

interface Props {
  phase: Phase;
  navCount: number;
  continueCount: number;
}

const MAX_NAV = 8;
const MAX_CONTINUE = 10;

const STATUS_CONFIG: Record<Phase, { label: string; cls: string }> = {
  idle:    { label: "Ready",   cls: "sp-status--idle" },
  running: { label: "Running", cls: "sp-status--running" },
  done:    { label: "Done",    cls: "sp-status--done" },
  error:   { label: "Error",   cls: "sp-status--error" },
};

export function Header({ phase, navCount, continueCount }: Props) {
  const status = STATUS_CONFIG[phase];

  return (
    <div className="sp-header">
      <div className="sp-badge">
        <span className="sp-badge-dot" />
        cverai Auto Apply
      </div>

      <div className={`sp-status ${status.cls}`}>
        <span className="sp-status-dot" />
        <span className="sp-status-label">{status.label}</span>
        {phase === "running" && (
          <span className="sp-status-counter">
            {navCount}/{MAX_NAV} · {continueCount}/{MAX_CONTINUE}
          </span>
        )}
      </div>
    </div>
  );
}
