import { useEffect, useState } from "react";

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
      }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `Gemini API error ${res.status}`);
  }

  const json = await res.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty response from Gemini");

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

  useEffect(() => {
    chrome.storage.local.get("geminiApiKey", (result) => {
      if (result.geminiApiKey) {
        setApiKey(result.geminiApiKey as string);
        setStatus("API key loaded. Click Analyze to scan this page.");
      }
    });
  }, []);

  function saveKey(key: string) {
    setApiKey(key);
    chrome.storage.local.set({ geminiApiKey: key });
  }

  async function analyze() {
    if (!apiKey.trim()) {
      setStatus("Please enter a Gemini API key first.");
      return;
    }
    setLoading(true);
    setDecision(null);
    setActionDone("");

    try {
      setStatus("Scanning page elements...");
      const elements = await new Promise<JobData>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "GET_JOB_ELEMENTS" }, (response) => {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
          if (response?.error) return reject(new Error(response.error as string));
          resolve(response as JobData);
        });
      });

      setStatus("Sending to Gemini...");
      const result = await callGemini(apiKey, elements);
      setDecision(result);
      setStatus(`Gemini decided: ${result.action.toUpperCase()}`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  function executeDecision() {
    if (!decision) return;

    if (decision.action === "fill") {
      chrome.runtime.sendMessage(
        { type: "FILL_FORM", fills: decision.fills },
        (response) => {
          if (chrome.runtime.lastError) {
            setActionDone(`Error: ${chrome.runtime.lastError.message}`);
            return;
          }
          const r = response as { filled?: number };
          setActionDone(`Filled ${r?.filled ?? 0} field(s).`);
        },
      );
    } else {
      chrome.runtime.sendMessage({ type: "NAVIGATE", url: decision.url }, () => {
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
      </div>
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>
        {lines.join("\n")}
      </pre>
    </div>
  );
}
