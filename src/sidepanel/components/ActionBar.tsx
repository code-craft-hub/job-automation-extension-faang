import type { Phase } from "../lib/types";

interface Props {
  phase: Phase;
  hasLogs: boolean;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
}

export function ActionBar({ phase, hasLogs, onStart, onStop, onClear }: Props) {
  const isRunning = phase === "running";

  return (
    <div className="sp-action-row">
      {isRunning ? (
        <button className="sp-btn sp-btn-stop" onClick={onStop}>
          <span className="sp-btn-icon">■</span>
          Stop
        </button>
      ) : (
        <button className="sp-btn sp-btn-primary" onClick={onStart}>
          <span className="sp-btn-icon">✦</span>
          Auto Apply
        </button>
      )}
      {hasLogs && (
        <button className="sp-btn sp-btn-ghost" onClick={onClear} title="Clear logs">
          Clear
        </button>
      )}
    </div>
  );
}
