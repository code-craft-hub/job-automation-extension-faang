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
    applyButtons: FieldInfo[];
    richTextEditors: FieldInfo[];
    customComponents: FieldInfo[];
    customSelects: FieldInfo[];
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
  | { action: "navigate"; reason: string; url: string }
  | { action: "click"; reason: string; buttonText: string };

type FillReportItem = {
  label: string;
  value: string;
  source: string;
  status: string;
};

type UnfilledField = {
  label: string;
  name?: string;
  id?: string;
  type: string;
  options?: string[];
};

type SubmitResult = {
  filled: number;
  submitted: boolean;
  pageAction: "submitted" | "continued" | "none";
  report: FillReportItem[];
  url: string;
  title: string;
  unfilledRequired?: UnfilledField[];
};

// ── Demo user ──────────────────────────────────────────────────────────────────

const DEMO_USER = {
  firstName: "John",
  lastName: "Doe",
  fullName: "John Doe",
  email: "john.doe@example.com",
  phone: "+16502831234",
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
  skills: "JavaScript, TypeScript, React, Node.js, Python",
  salaryExpectation: "120000",
  noticePeriod: "2 weeks",
  workAuthorized: "Yes",
  requiresSponsorship: "No",
  coverLetter:
    "Dear Hiring Manager,\n\nI am excited to apply for this position. With 5 years of software engineering experience, I bring strong expertise in JavaScript, TypeScript, React, and Node.js.\n\nBest regards,\nJohn Doe",
  // Structured education history (for profile sections)
  educationHistory: [
    {
      school: "University of California, Berkeley",
      degree: "Bachelor of Science",
      fieldOfStudy: "Computer Science",
      startYear: "2015",
      endYear: "2019",
      gpa: "3.8",
    },
  ],
  // Structured work experience (for profile sections)
  workExperience: [
    {
      company: "Tech Corp",
      title: "Software Engineer",
      startDate: "07/2019",
      endDate: "present",
      description:
        "Developed full-stack web applications using React, TypeScript, and Node.js. Led a team of 3 engineers and improved application performance by 40%.",
    },
    {
      company: "StartupXYZ",
      title: "Junior Developer",
      startDate: "05/2018",
      endDate: "06/2019",
      description:
        "Worked on front-end development with React and Redux. Implemented UI components and integrated REST APIs.",
    },
  ],
  // Sentinel value — triggers automatic PDF upload to file inputs
  resumeFile: "[RESUME]",
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
    ...data.categories.customSelects,
  ].filter((f) => f.visible !== false).length;
}

function buildPrompt(data: JobData): string {
  const visible = (f: FieldInfo) => f.visible !== false;

  // Group radios by name — filter huge groups (phone country codes = 90+ options)
  const radioGroupMap: Record<string, { label: string; name: string; required?: boolean; options: string[] }> = {};
  for (const f of data.categories.radios.filter(visible)) {
    const key = f.name ?? "_";
    if (!radioGroupMap[key]) radioGroupMap[key] = { label: f.label, name: key, required: f.required, options: [] };
    if (f.value && !radioGroupMap[key].options.includes(f.value)) radioGroupMap[key].options.push(f.value);
  }
  const radioGroups = Object.values(radioGroupMap).filter((g) => g.options.length <= 8);

  const summary = {
    url: data.url,
    title: data.title,
    totalVisibleInputs: countVisibleInputs(data),
    visibleFormFields: {
      textFields: data.categories.textFields.filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id, required: f.required })),
      dateFields: data.categories.dateFields.filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id })),
      fileUploads: data.categories.fileUploads.filter(visible).map((f) => ({ label: f.label, name: f.name, accept: f.value, note: "Extension auto-uploads resume — no fill instruction needed" })),
      checkboxes: data.categories.checkboxes.filter(visible).map((f) => ({ label: f.label, name: f.name, required: f.required })),
      radioGroups,
      dropdowns: data.categories.dropdowns.filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id, required: f.required, options: f.options?.slice(0, 12) })),
      // Custom React/JS dropdowns — fill by label; extension will click-open and pick the option
      customSelects: data.categories.customSelects.filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id, required: f.required, currentValue: f.value })),
      textareas: data.categories.textareas.filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id, required: f.required })),
    },
    applyButtons: data.categories.applyButtons.map((f) => ({ text: f.value, href: f.href ?? null })),
    navigationLinks: data.categories.navigationLinks.map((f) => ({ text: f.value, href: f.href })),
  };

  return `You are a job application assistant helping fill out a job application form.

DEMO USER DATA:
${JSON.stringify(DEMO_USER, null, 2)}

JOB PAGE CONTEXT:
${data.pageText ?? "(not available)"}

PAGE ELEMENTS (visible only):
${JSON.stringify(summary, null, 2)}

TASK — decide ONE action:

1. "click" — HIGHEST PRIORITY if applyButtons is non-empty.
   - Use the button text as buttonText.
   - Some "Apply now" buttons open a dropdown — the extension auto-handles the sub-item click.

2. "fill" — if the page is clearly part of a job application (any form step):
   - Fill EVERY visible form field. Nothing should be skipped or left empty.
   - textFields / textareas: match demo user data (source:"demo_user"); generate concise relevant answers for unmatched fields (source:"ai_generated").
   - customSelects: MUST include a fill instruction for EACH custom select. Pick the most appropriate value for the context (e.g. for "Qualification" choose a degree level like "Master's Degree"; for "Areas of Expertise" choose the most relevant expertise). Match by label. The extension will click-open and auto-select the option.
   - dropdowns (native): pick the most appropriate non-placeholder option.
   - radioGroups: pick one option value. For YES/NO questions, pick "yes".
   - checkboxes: Terms/consent/privacy → value:"true". Marketing opt-in → value:"false". When in doubt, value:"true".
   - fileUploads: DO NOT include fill instructions — the extension auto-uploads the resume PDF.
   - Education/Experience fields (school, degree, company, job title, start/end dates): fill using DEMO_USER.educationHistory[0] and DEMO_USER.workExperience[0].
   - Every fill instruction must include: label AND (name OR id if available), value, source.
   - Review page (totalVisibleInputs=0, submit button visible): return fills:[] — extension clicks Submit automatically.

3. "navigate" — ONLY if pure listing page with NO applyButtons and NO form visible.
   - Use a real URL from navigationLinks. NEVER invent a URL.

Key rules:
- applyButtons non-empty → always "click"
- Any page with a form → always "fill" every single visible field including all customSelects
- Pure listing with no form and no applyButtons → "navigate"

Respond with ONLY valid JSON, no markdown:
Fill: {"action":"fill","reason":"...","fills":[{"label":"Qualification","value":"Master's Degree","source":"demo_user"},{"label":"Areas of Expertise Sought","value":"Software Engineering","source":"ai_generated"},...]}
Click: {"action":"click","reason":"...","buttonText":"Apply now"}
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
  const navCountRef = useRef(0);   // steps taken to FIND the form (navigate/click)
  const continueCountRef = useRef(0); // steps taken WITHIN the form (continue/next page)
  const MAX_NAV = 8;
  const MAX_CONTINUE = 10;
  const runCycleRef = useRef<(() => Promise<void>) | null>(null);
  // Fallback timer: re-runs cycle if a click doesn't cause navigation (in-page form reveal)
  const clickFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        if (clickFallbackTimerRef.current) {
          clearTimeout(clickFallbackTimerRef.current);
          clickFallbackTimerRef.current = null;
        }
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
      chrome.runtime.sendMessage({ type: "FILL_AND_SUBMIT", fills, submitForm: true }, (response) => {
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

  // Fill fields without clicking the submit/continue button — used for pass 1.
  function doFillFields(fills: FillInstruction[]): Promise<SubmitResult> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "FILL_AND_SUBMIT", fills, submitForm: false }, (response) => {
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

  // Click "Add Education" / "Add Experience" buttons so their fields become visible before scanning.
  function expandProfileSections(): Promise<{ expanded: number }> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "EXPAND_PROFILE_SECTIONS" }, (response) => {
        if (chrome.runtime.lastError) { resolve({ expanded: 0 }); return; }
        resolve((response as { expanded: number }) ?? { expanded: 0 });
      });
    });
  }

  // Ask Gemini specifically for fill values for fields that are still empty/required.
  async function callGeminiForRemaining(fields: UnfilledField[], pageText: string): Promise<FillInstruction[]> {
    const prompt = `You are a job application assistant. These required form fields are still empty after the initial fill pass. Generate ONE fill value for EACH field.

JOB PAGE CONTEXT:
${pageText || "(not available)"}

DEMO USER DATA:
${JSON.stringify(DEMO_USER, null, 2)}

UNFILLED REQUIRED FIELDS:
${JSON.stringify(fields, null, 2)}

Rules:
- radio (options list given): pick the most appropriate option value from the options array. For YES/NO questions, choose "yes" (the affirmative).
- select (options list given): pick the most appropriate non-empty option value.
- textarea / text: generate a concise, relevant answer based on the job context and demo user data.
- invalid: re-supply the correct value — something went wrong with the previous fill.
- ALWAYS include name or id in each instruction (use what was provided).
- source must be "ai_generated".

Respond with ONLY a valid JSON array, no markdown:
[{"name":"field_name","id":"field_id","label":"Field Label","value":"chosen value","source":"ai_generated"}, ...]`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(err?.error?.message ?? `Gemini API error ${res.status}`);
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error("Empty response from Gemini (remaining fields)");
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    return JSON.parse(text) as FillInstruction[];
  }

  // ── Main loop ─────────────────────────────────────────────────────────────────

  async function runCycle() {
    if (!isRunningRef.current) return;

    try {
      // Expand profile sections (Education/Experience Add buttons) before scanning
      // so the revealed fields are visible to the scanner and Gemini.
      const expanded = await expandProfileSections();
      if (expanded.expanded > 0) log(`← Expanded ${expanded.expanded} profile section(s)`);

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
        const url = decision.url;
        if (!url || url === "null") {
          throw new Error("Gemini returned no valid URL to navigate to.");
        }
        navCountRef.current++;
        log(`→ Navigating [${navCountRef.current}/${MAX_NAV}]: ${url}`);
        chrome.runtime.sendMessage({ type: "NAVIGATE", url });

      } else if (decision.action === "click") {
        if (navCountRef.current >= MAX_NAV) {
          throw new Error(`Reached max ${MAX_NAV} navigations without finding a form.`);
        }
        navCountRef.current++;
        log(`→ Clicking button [${navCountRef.current}/${MAX_NAV}]: "${decision.buttonText}"`);
        // Tell background to watch for a new tab (Apply may open in a new tab)
        chrome.runtime.sendMessage({ type: "WATCH_FOR_NEW_TAB" });
        chrome.runtime.sendMessage({ type: "CLICK_BUTTON", buttonText: decision.buttonText });
        // TAB_READY fires if navigation/new-tab happens; fallback handles in-page form reveal
        clickFallbackTimerRef.current = setTimeout(() => {
          clickFallbackTimerRef.current = null;
          if (isRunningRef.current) {
            log("← No navigation detected — re-analyzing page...");
            runCycleRef.current?.();
          }
        }, 3000);

      } else {
        // ── Pass 1: fill Gemini's fields (no submit yet, triggers validation) ──────
        if (decision.fills.length > 0) {
          log(`→ Filling ${decision.fills.length} field(s) — pass 1...`);
          for (const f of decision.fills) {
            const tag = f.source === "ai_generated" ? "[AI]" : "[demo]";
            log(`   ${tag} "${f.label ?? f.name ?? f.id}" = "${f.value}"`);
          }
        } else {
          log("→ Review page — scanning for unfilled required fields...");
        }

        const pass1 = await doFillFields(decision.fills);
        const unfilled = pass1.unfilledRequired ?? [];

        // ── Pass 2: generate values for still-empty required fields ───────────────
        let allFills = [...decision.fills];
        if (unfilled.length > 0) {
          log(`→ ${unfilled.length} required field(s) still empty after pass 1:`);
          for (const f of unfilled) {
            log(`   [?] "${f.label}" (${f.type}${f.options?.length ? ": " + f.options.join(" | ") : ""})`);
          }
          log("→ Asking Gemini to generate values for remaining fields...");
          const additionalFills = await callGeminiForRemaining(unfilled, elements.pageText ?? "");
          log(`← Generated ${additionalFills.length} additional fill(s)`);
          for (const f of additionalFills) {
            log(`   [AI] "${f.label ?? f.name ?? f.id}" = "${f.value}"`);
          }
          allFills = [...allFills, ...additionalFills];
        }

        // ── Submit: re-fill everything + click submit/continue ────────────────────
        const result = await doFillAndSubmit(allFills);

        if (result.pageAction === "continued") {
          if (continueCountRef.current >= MAX_CONTINUE) {
            throw new Error(`Reached max ${MAX_CONTINUE} form pages without final submission.`);
          }
          continueCountRef.current++;
          log(`→ Clicked Continue [page ${continueCountRef.current}/${MAX_CONTINUE}] — waiting for next page...`);
          chrome.runtime.sendMessage({ type: "WATCH_CURRENT_TAB" });
          // TAB_READY fires on real navigation; fallback handles validation errors (page stays same)
          clickFallbackTimerRef.current = setTimeout(() => {
            clickFallbackTimerRef.current = null;
            if (isRunningRef.current) {
              log("← No navigation — re-analyzing (validation error or same-page update)...");
              runCycleRef.current?.();
            }
          }, 3500);

        } else {
          setSubmitResult(result);
          setPhase("done");
          isRunningRef.current = false;
          if (result.submitted) {
            log(`✓ Application submitted! Filled ${result.filled} field(s) across ${continueCountRef.current + 1} page(s).`);
          } else {
            log(`✓ Done (no submit button found). Filled ${result.filled} field(s).`);
          }
        }
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
    continueCountRef.current = 0;
    setSubmitResult(null);
    setLogs([]);
    setPhase("running");
    log("Auto Apply started.");
    await runCycle();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const phaseLabel: Record<Phase, string> = {
    idle: "",
    running: `Running... (nav: ${navCountRef.current}/${MAX_NAV}, pages: ${continueCountRef.current}/${MAX_CONTINUE})`,
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
