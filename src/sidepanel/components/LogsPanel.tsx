import { useEffect, useRef } from "react";

interface Props {
  logs: string[];
}

function lineClass(line: string): string {
  if (line.includes("✗") || line.includes("[!]")) return "sp-log--error";
  if (line.includes("✓") || line.includes("Done") || line.includes("applied")) return "sp-log--success";
  if (line.includes("→") || line.includes("←")) return "sp-log--action";
  return "";
}

export function LogsPanel({ logs }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <div className="sp-logs-wrap">
      <div className="sp-logs-header">
        <span className="sp-section-label">Activity Log</span>
        <span className="sp-logs-count">{logs.length} entries</span>
      </div>
      <div className="sp-logs-body">
        {logs.map((line, i) => (
          <div key={i} className={`sp-log-line ${lineClass(line)}`}>
            {line}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
