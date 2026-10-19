import { useEffect, useState } from "react";
import { useAutoApply } from "./hooks/useAutoApply";
import { Header } from "./components/Header";
import { JobCard } from "./components/JobCard";
import { ApiKeyInput } from "./components/ApiKeyInput";
import { ActionBar } from "./components/ActionBar";
import { LogsPanel } from "./components/LogsPanel";
import { ReportPanel } from "./components/ReportPanel";

export default function App() {
  const [apiKey, setApiKey] = useState("");

  const { phase, logs, jobInfo, submitResult, navCount, continueCount, startAutoApply, stop, clearLogs } =
    useAutoApply(apiKey);

  // Load saved API key on mount
  useEffect(() => {
    chrome.storage.local.get("geminiApiKey", (result) => {
      const key = result.geminiApiKey as string | undefined;
      if (key) setApiKey(key);
    });
  }, []);

  function saveKey(key: string) {
    setApiKey(key);
    chrome.storage.local.set({ geminiApiKey: key });
  }

  return (
    <div className="sp-shell">
      <Header phase={phase} navCount={navCount} continueCount={continueCount} />

      <div className="sp-content">
        <JobCard jobInfo={jobInfo} phase={phase} />

        <ApiKeyInput value={apiKey} onChange={saveKey} />

        <ActionBar
          phase={phase}
          hasLogs={logs.length > 0}
          onStart={startAutoApply}
          onStop={stop}
          onClear={clearLogs}
        />

        {submitResult && <ReportPanel result={submitResult} />}

        <LogsPanel logs={logs} />

        {logs.length === 0 && phase === "idle" && !jobInfo && (
          <div className="sp-empty">
            <div className="sp-empty-icon">⚡</div>
            <div className="sp-empty-heading">Ready to apply</div>
            <div className="sp-empty-text">
              Click <strong>Apply Now</strong> on any job listing and the automation will start here automatically.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
