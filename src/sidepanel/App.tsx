import { useEffect, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

type FieldInfo = {
  label: string;
  name?: string;
  id?: string;
  required?: boolean;
  visible?: boolean;
  value?: string;
  href?: string;
  options?: string[];
};

type JobData = {
  url: string;
  title: string;
  pageText?: string;
  totals: Record<string, number>;
  categories: {
    textFields: FieldInfo[];
    dateFields: FieldInfo[];
    fileUploads: FieldInfo[];
    checkboxes: FieldInfo[];
    radios: FieldInfo[];
    dropdowns: FieldInfo[];
    textareas: FieldInfo[];
    buttons: FieldInfo[];
    navigationLinks: FieldInfo[];
    richTextEditors: FieldInfo[];
    customComponents: FieldInfo[];
    hiddenInputs: FieldInfo[];
  };
};

type FillInstruction = {
  name?: string;
  id?: string;
  label?: string;
  value: string;
  source?: string;
};

type Decision =
  | { action: "fill"; reason: string; fills: FillInstruction[] }
  | { action: "navigate"; reason: string; url: string };

type FillReportItem = {
  label: string;
  value: string;
  source: string;
  status: string;
};

type SubmitResult = {
  filled: number;
  submitted: boolean;
  report: FillReportItem[];
  url: string;
  title: string;
};

// ── Demo user ──────────────────────────────────────────────────────────────────

const DEMO_USER = {
  firstName: "John",
  lastName: "Doe",
  fullName: "John Doe",
  email: "john.doe@example.com",
  phone: "+1-555-0100",
  address: "123 Main Street",
  city: "San Francisco",
  state: "California",
  country: "United States",
  zipCode: "94105",
  linkedin: "https://linkedin.com/in/johndoe",
  github: "https://github.com/johndoe",
  portfolio: "https://johndoe.dev",
  currentCompany: "Tech Corp",
  currentTitle: "Software Engineer",
  yearsExperience: "5",
  education: "Bachelor's in Computer Science",
  university: "University of California",
  graduationYear: "2019",
  skills: "JavaScript, TypeScript, React, Node.js, Python",
  salaryExpectation: "120000",
  noticePeriod: "2 weeks",
  workAuthorized: "Yes",
  requiresSponsorship: "No",
  coverLetter:
    "Dear Hiring Manager,\n\nI am excited to apply for this position. With 5 years of software engineering experience, I bring strong expertise in JavaScript, TypeScript, React, and Node.js.\n\nBest regards,\nJohn Doe",
};

// ── Gemini ─────────────────────────────────────────────────────────────────────

function countVisibleInputs(data: JobData): number {
  return [
    ...data.categories.textFields,
    ...data.categories.dateFields,
    ...data.categories.fileUploads,
    ...data.categories.checkboxes,
    ...data.categories.radios,
    ...data.categories.dropdowns,
    ...data.categories.textareas,
  ].filter((f) => f.visible !== false).length;
}

function buildPrompt(data: JobData): string {
  const visible = (f: FieldInfo) => f.visible !== false;

  const summary = {
    url: data.url,
    title: data.title,
    totalVisibleInputs: countVisibleInputs(data),
    visibleFormFields: {
      textFields: data.categories.textFields.filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id, required: f.required })),
      dateFields: data.categories.dateFields.filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id })),
      fileUploads: data.categories.fileUploads.filter(visible).map((f) => ({ label: f.label, name: f.name, accept: f.value })),
      checkboxes: data.categories.checkboxes.filter(visible).map((f) => ({ label: f.label, name: f.name })),
      radios: data.categories.radios.filter(visible).map((f) => ({ label: f.label, name: f.name, value: f.value })),
      dropdowns: data.categories.dropdowns.filter(visible).map((f) => ({ label: f.label, name: f.name, options: f.options?.slice(0, 8) })),
      textareas: data.categories.textareas.filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id, required: f.required })),
    },
    navigationLinks: data.categories.navigationLinks.slice(0, 10).map((f) => ({
      text: f.value,
      href: f.href,
    })),
  };

  return `You are a job application assistant.

DEMO USER DATA:
${JSON.stringify(DEMO_USER, null, 2)}

JOB PAGE CONTEXT:
${data.pageText ?? "(not available)"}

PAGE ELEMENTS (visible only):
${JSON.stringify(summary, null, 2)}

TASK — decide ONE action:

1. "fill" — ONLY if totalVisibleInputs > 2 AND the visible fields are clearly a job application form (name, email, CV, cover letter, etc.).
   - Map demo user data to matching fields (source: "demo_user")
   - For fields NOT covered by demo user data (e.g. "Why do you want this role?", "Describe your experience with X", specific skill assessments), generate a realistic, relevant answer based on the job page context and the user's background (source: "ai_generated")
   - Every fill must include: name or id, label (human-readable field name), value, source

2. "navigate" — if this is a job listing/description page, OR if visible inputs are just a search bar / email subscription form (not an application).
   - Choose the single best URL from navigationLinks that leads to a job application form.

Key rule: If the page shows a job description with qualifications and "how to apply" instructions but no real application form fields → choose "navigate".

Respond with ONLY valid JSON, no markdown:
Fill: {"action":"fill","reason":"...","fills":[{"name":"fn","label":"First Name","value":"John","source":"demo_user"},...]}
Navigate: {"action":"navigate","reason":"...","url":"https://..."}`;
}

async function callGemini(apiKey: string, data: JobData): Promise<Decision> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(data) }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
  );

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `Gemini API error ${res.status}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty response from Gemini");

  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(text) as Decision;
  } catch {
    throw new Error(`Could not parse Gemini response: ${text.slice(0, 120)}`);
  }
}

// ── Report renderer ────────────────────────────────────────────────────────────

function renderReport(result: SubmitResult): string {
  const lines = [
    "── SUBMIT REPORT ─────────────────────────────",
    `Page:      ${result.title}`,
    `URL:       ${result.url}`,
    `Submitted: ${result.submitted ? "YES ✓" : "NO (submit button not found)"}`,
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

// ── Component ──────────────────────────────────────────────────────────────────

type Phase = "idle" | "running" | "done" | "error";

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-loop engine refs
  const isRunningRef = useRef(false);
  const navCountRef = useRef(0);
  const MAX_NAV = 5;
  const runCycleRef = useRef<(() => Promise<void>) | null>(null);

  function log(msg: string) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log("[SP]", msg);
    setLogs((prev) => [...prev, entry]);
  }

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Load saved API key
  useEffect(() => {
    chrome.storage.local.get("geminiApiKey", (result) => {
      if (result.geminiApiKey) {
        setApiKey(result.geminiApiKey as string);
        log("API key loaded. Click Auto Apply to start.");
      } else {
        log("No API key found. Enter one above.");
      }
    });
  }, []);

  // Listen for TAB_READY from background (fires when navigated tab finishes loading)
  useEffect(() => {
    const handler = (message: unknown) => {
      if ((message as { type?: string }).type === "TAB_READY" && isRunningRef.current) {
        log("← Page loaded — re-analyzing in 1s...");
        setTimeout(() => runCycleRef.current?.(), 1000);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // Keep runCycle ref up-to-date after every render (avoids stale closure)
  useEffect(() => {
    runCycleRef.current = runCycle;
  });

  function saveKey(key: string) {
    setApiKey(key);
    chrome.storage.local.set({ geminiApiKey: key });
  }

  function stop() {
    isRunningRef.current = false;
    setPhase("idle");
    log("Stopped.");
  }

  // ── Core helpers ─────────────────────────────────────────────────────────────

  function scanPage(): Promise<JobData> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "GET_JOB_ELEMENTS" }, (response) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message ?? "Unknown";
          reject(new Error(msg.includes("Receiving end") ? "Content script not found. Reload the page." : msg));
          return;
        }
        const r = response as { error?: string } & JobData;
        if (r.error) {
          reject(new Error(r.error.includes("Receiving end") ? "Content script not found. Reload the page." : r.error));
          return;
        }
        resolve(r);
      });
    });
  }

  function doFillAndSubmit(fills: FillInstruction[]): Promise<SubmitResult> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "FILL_AND_SUBMIT", fills }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? "Unknown"));
          return;
        }
        const r = response as { error?: string } & SubmitResult;
        if (r.error) { reject(new Error(r.error)); return; }
        resolve(r);
      });
    });
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────

  async function runCycle() {
    if (!isRunningRef.current) return;

    try {
      log(`[step ${navCountRef.current + 1}] Scanning page elements...`);
      const elements = await scanPage();

      const totals = Object.entries(elements.totals)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const visibleCount = countVisibleInputs(elements);
      log(`← ${totals}`);
      log(`   Visible inputs: ${visibleCount}`);

      log("→ Asking Gemini...");
      const decision = await callGemini(apiKey, elements);
      log(`← Gemini: ${decision.action.toUpperCase()} — ${decision.reason}`);

      if (decision.action === "navigate") {
        if (navCountRef.current >= MAX_NAV) {
          throw new Error(`Reached max ${MAX_NAV} navigations without finding a form.`);
        }
        navCountRef.current++;
        log(`→ Navigating [${navCountRef.current}/${MAX_NAV}]: ${decision.url}`);
        // Navigate — background watches the tab and sends TAB_READY when loaded
        chrome.runtime.sendMessage({ type: "NAVIGATE", url: decision.url });
        // runCycle will be called again by the TAB_READY listener

      } else {
        log(`→ Filling ${decision.fills.length} field(s)...`);
        for (const f of decision.fills) {
          const tag = f.source === "ai_generated" ? "[AI]" : "[demo]";
          log(`   ${tag} "${f.label ?? f.name ?? f.id}" = "${f.value}"`);
        }

        const result = await doFillAndSubmit(decision.fills);
        setSubmitResult(result);
        setPhase("done");
        isRunningRef.current = false;
        log(`✓ Done! Filled ${result.filled}/${decision.fills.length} field(s). Submitted: ${result.submitted ? "YES" : "NO"}`);
      }
    } catch (err) {
      isRunningRef.current = false;
      setPhase("error");
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${msg}`);
    }
  }

  async function startAutoApply() {
    if (!apiKey.trim()) { log("✗ No API key set."); return; }
    isRunningRef.current = true;
    navCountRef.current = 0;
    setSubmitResult(null);
    setLogs([]);
    setPhase("running");
    log("Auto Apply started.");
    await runCycle();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const phaseLabel: Record<Phase, string> = {
    idle: "",
    running: `Running... (navigations: ${navCountRef.current}/${MAX_NAV})`,
    done: "✓ Complete",
    error: "✗ Stopped with error",
  };

  return (
    <div style={{ fontFamily: "monospace", fontSize: "12px", padding: "8px" }}>
      <input
        type="password"
        placeholder="Gemini API key (saved locally)"
        value={apiKey}
        onChange={(e) => saveKey(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", marginBottom: "6px" }}
      />

      <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
        {phase !== "running" ? (
          <button onClick={startAutoApply}>Auto Apply</button>
        ) : (
          <button onClick={stop}>Stop</button>
        )}
        {logs.length > 0 && (
          <button onClick={() => setLogs([])}>Clear logs</button>
        )}
      </div>

      {phaseLabel[phase] && (
        <div style={{ marginBottom: "6px", opacity: 0.8 }}>{phaseLabel[phase]}</div>
      )}

      {submitResult && (
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            margin: "0 0 10px",
            borderBottom: "1px solid #555",
            paddingBottom: "8px",
          }}
        >
          {renderReport(submitResult)}
        </pre>
      )}

      {logs.length > 0 && (
        <div>
          <div style={{ opacity: 0.5, marginBottom: "4px" }}>── LOGS ──</div>
          <pre
            style={{
              fontSize: "10px",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: "260px",
              overflowY: "auto",
            }}
          >
            {logs.join("\n")}
            <div ref={logsEndRef} />
          </pre>
        </div>
      )}
    </div>
  );
}
