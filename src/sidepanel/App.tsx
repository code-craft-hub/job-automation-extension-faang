import { useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldInfo = {
  label: string;
  name?: string;
  id?: string;
  required?: boolean;
  value?: string;
  href?: string;
  options?: string[];
};

type JobData = {
  url: string;
  title: string;
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

type FillInstruction = { name?: string; id?: string; value: string };

type Decision =
  | { action: "fill"; reason: string; fills: FillInstruction[] }
  | { action: "navigate"; reason: string; url: string };

// ── Demo user ─────────────────────────────────────────────────────────────────

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

// ── Gemini ────────────────────────────────────────────────────────────────────

function buildPrompt(data: JobData): string {
  const summary = {
    url: data.url,
    title: data.title,
    textFields: data.categories.textFields.map((f) => ({
      label: f.label,
      name: f.name,
      id: f.id,
      required: f.required,
    })),
    dateFields: data.categories.dateFields.map((f) => ({
      label: f.label,
      name: f.name,
      id: f.id,
    })),
    fileUploads: data.categories.fileUploads.map((f) => ({
      label: f.label,
      name: f.name,
      accept: f.value,
    })),
    checkboxes: data.categories.checkboxes.map((f) => ({
      label: f.label,
      name: f.name,
    })),
    radios: data.categories.radios.map((f) => ({
      label: f.label,
      name: f.name,
      value: f.value,
    })),
    dropdowns: data.categories.dropdowns.map((f) => ({
      label: f.label,
      name: f.name,
      options: f.options?.slice(0, 8),
    })),
    textareas: data.categories.textareas.map((f) => ({
      label: f.label,
      name: f.name,
      id: f.id,
      required: f.required,
    })),
    navigationLinks: data.categories.navigationLinks.slice(0, 10).map((f) => ({
      text: f.value,
      href: f.href,
    })),
  };

  return `You are a job application assistant.

DEMO USER DATA:
${JSON.stringify(DEMO_USER, null, 2)}

PAGE ELEMENTS:
${JSON.stringify(summary, null, 2)}

TASK:
Decide ONE action:
1. "fill" — if this page has a job application form with fields to fill in
2. "navigate" — if this page is a job listing/search page with links to navigate to

For "fill": map the demo user data to each form field. Use the "name" attribute to identify fields (fall back to "id"). Only include relevant, visible fields. Skip CSRF/tracking hidden fields.

For "navigate": choose the single best URL from navigationLinks that leads directly to a job application or posting.

Respond with ONLY valid JSON, no markdown or extra text:
Fill: {"action":"fill","reason":"...","fills":[{"name":"fieldName","value":"..."},{"id":"fieldId","value":"..."}]}
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
    const err = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(err?.error?.message ?? `Gemini API error ${res.status}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty response from Gemini");

  // Strip markdown code fences if Gemini ignores responseMimeType
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  try {
    return JSON.parse(text) as Decision;
  } catch {
    throw new Error(`Could not parse Gemini response: ${text.slice(0, 120)}`);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("Enter your Gemini API key, then click Analyze.");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionDone, setActionDone] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  function log(msg: string) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log("[SP]", msg);
    setLogs((prev) => [...prev, entry]);
  }

  // Auto-scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    log("Side panel mounted");
    chrome.storage.local.get("geminiApiKey", (result) => {
      if (result.geminiApiKey) {
        setApiKey(result.geminiApiKey as string);
        setStatus("API key loaded. Click Analyze to scan this page.");
        log("API key loaded from storage");
      } else {
        log("No API key in storage");
      }
    });
  }, []);

  function saveKey(key: string) {
    setApiKey(key);
    chrome.storage.local.set({ geminiApiKey: key });
    log("API key saved to storage");
  }

  async function analyze() {
    if (!apiKey.trim()) {
      setStatus("Please enter a Gemini API key first.");
      log("Analyze blocked: no API key");
      return;
    }
    setLoading(true);
    setDecision(null);
    setActionDone("");
    log("Analyze started");

    try {
      setStatus("Scanning page elements...");
      log("→ Sending GET_JOB_ELEMENTS to background...");

      const elements = await new Promise<JobData>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "GET_JOB_ELEMENTS" }, (response) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message ?? "Unknown error";
            log(`✗ Runtime error: ${msg}`);
            if (msg.includes("Receiving end does not exist")) {
              return reject(
                new Error(
                  "Content script not found on this tab.\n→ Reload the page (F5) and try again.\n→ Only works on https:// pages.",
                ),
              );
            }
            return reject(new Error(msg));
          }
          if (response?.error) {
            const msg = response.error as string;
            log(`✗ Response error: ${msg}`);
            if (msg.includes("Receiving end does not exist")) {
              return reject(
                new Error(
                  "Content script not found on this tab.\n→ Reload the page (F5) and try again.\n→ Only works on https:// pages.",
                ),
              );
            }
            return reject(new Error(msg));
          }
          resolve(response as JobData);
        });
      });

      const totals = Object.entries(elements.totals)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      log(`← Elements received — ${totals}`);
      log(`   Page: "${elements.title}" (${elements.url})`);

      setStatus("Sending to Gemini...");
      log("→ Calling Gemini API...");

      const result = await callGemini(apiKey, elements);
      log(`← Gemini decision: ${result.action.toUpperCase()} — ${result.reason}`);

      if (result.action === "fill") {
        log(`   ${result.fills.length} field(s) to fill:`);
        result.fills.forEach((f) => {
          const key = f.name ? `name="${f.name}"` : `id="${f.id}"`;
          log(`   ${key} = "${f.value}"`);
        });
      } else {
        log(`   URL: ${result.url}`);
      }

      setDecision(result);
      setStatus(`Gemini decided: ${result.action.toUpperCase()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ Error: ${msg}`);
      setStatus(`Error: ${msg}`);
    } finally {
      setLoading(false);
      log("Analyze complete");
    }
  }

  function executeDecision() {
    if (!decision) return;

    if (decision.action === "fill") {
      log(`→ Sending FILL_FORM (${decision.fills.length} fields)...`);
      chrome.runtime.sendMessage(
        { type: "FILL_FORM", fills: decision.fills },
        (response) => {
          if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message ?? "Unknown error";
            log(`✗ Fill error: ${msg}`);
            setActionDone(`Error: ${msg}`);
            return;
          }
          const r = response as { filled?: number };
          log(`← Fill result: ${r?.filled ?? 0} field(s) filled`);
          setActionDone(`Filled ${r?.filled ?? 0} field(s).`);
        },
      );
    } else {
      log(`→ Sending NAVIGATE to: ${decision.url}`);
      chrome.runtime.sendMessage({ type: "NAVIGATE", url: decision.url }, () => {
        log("← Navigate sent");
        setActionDone(`Navigating to: ${decision.url}`);
      });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const lines: string[] = [status, ""];

  if (decision) {
    lines.push(`Action : ${decision.action.toUpperCase()}`);
    lines.push(`Reason : ${decision.reason}`);
    lines.push("");

    if (decision.action === "fill") {
      lines.push(`Fields to fill: ${decision.fills.length}`);
      for (const f of decision.fills) {
        const key = f.name ? `name="${f.name}"` : `id="${f.id}"`;
        lines.push(`  ${key} = "${f.value}"`);
      }
    } else {
      lines.push(`URL: ${decision.url}`);
    }
  }

  if (actionDone) {
    lines.push("", actionDone);
  }

  return (
    <div style={{ fontFamily: "monospace", fontSize: "12px", padding: "8px" }}>
      <input
        type="password"
        placeholder="Gemini API key (saved locally)"
        value={apiKey}
        onChange={(e) => saveKey(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", marginBottom: "6px" }}
      />
      <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
        <button onClick={analyze} disabled={loading}>
          {loading ? "Analyzing..." : "Analyze Page"}
        </button>
        {decision && !loading && (
          <button onClick={executeDecision}>
            {decision.action === "fill" ? "Fill Form" : "Navigate"}
          </button>
        )}
        {logs.length > 0 && (
          <button onClick={() => setLogs([])} style={{ marginLeft: "auto" }}>
            Clear logs
          </button>
        )}
      </div>
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>
        {lines.join("\n")}
      </pre>
      {logs.length > 0 && (
        <div
          style={{
            marginTop: "10px",
            borderTop: "1px solid #555",
            paddingTop: "6px",
          }}
        >
          <div style={{ opacity: 0.6, marginBottom: "4px" }}>── LOGS ──</div>
          <pre
            style={{
              fontSize: "10px",
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: "200px",
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
