import type { JobData, Decision, FillInstruction, UnfilledField, FieldInfo } from "./types";
import { DEMO_USER } from "./constants";

export function countVisibleInputs(data: JobData): number {
  return [
    ...data.categories.textFields,
    ...data.categories.dateFields,
    ...data.categories.fileUploads,
    ...data.categories.checkboxes,
    ...data.categories.radios,
    ...data.categories.dropdowns,
    ...data.categories.textareas,
    ...(data.categories.customSelects ?? []),
    ...(data.categories.yesNoQuestions ?? []),
    ...(data.categories.ariaRadioGroups ?? []),
    ...(data.categories.ariaCheckboxGroups ?? []),
  ].filter((f) => f.visible !== false).length;
}

export function buildPrompt(data: JobData): string {
  const visible = (f: FieldInfo) => f.visible !== false;

  const radioGroupMap: Record<string, { label: string; name: string; required?: boolean; options: string[] }> = {};
  for (const f of data.categories.radios) {
    const key = f.name ?? "_";
    if (!radioGroupMap[key]) radioGroupMap[key] = { label: f.label, name: key, required: f.required, options: [] };
    const optionText = f.value ?? f.label;
    if (optionText && !radioGroupMap[key].options.includes(optionText)) radioGroupMap[key].options.push(optionText);
  }
  const radioGroups = Object.values(radioGroupMap).filter((g) => g.options.length >= 2 && g.options.length <= 12);

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
      customSelects: (data.categories.customSelects ?? []).filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id, required: f.required, currentValue: f.value, options: f.options })),
      textareas: data.categories.textareas.filter(visible).map((f) => ({ label: f.label, name: f.name, id: f.id, required: f.required })),
      yesNoQuestions: (data.categories.yesNoQuestions ?? [])
        .filter(f => f.value !== 'answered')
        .map((f) => ({ label: f.label, required: f.required, options: ['yes', 'no'] })),
      ariaRadioGroups: (data.categories.ariaRadioGroups ?? []).filter(visible).map((f) => ({
        label: f.label, required: f.required, currentValue: f.value ?? null, options: f.options,
        type: 'single_choice',
      })),
      ariaCheckboxGroups: (data.categories.ariaCheckboxGroups ?? []).filter(visible).map((f) => ({
        label: f.label, required: f.required, currentValue: f.value ?? null, options: f.options,
        type: 'multi_choice',
      })),
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
   - dateFields: MUST include a fill instruction for EACH date field. Use DEMO_USER.dateOfBirth when the field asks for date of birth/birthday. Value MUST be in YYYY-MM-DD format (e.g. "1990-01-15"). NEVER use MM/DD/YYYY, "January 15, 1990", or any other format.
   - customSelects: MUST include a fill instruction for EACH custom select. Pick the most appropriate value for the context (e.g. for "Qualification" choose a degree level like "Master's Degree"; for "Areas of Expertise" choose the most relevant expertise). Match by label. The extension will click-open and auto-select the option.
   - dropdowns (native): pick the most appropriate non-placeholder option.
   - radioGroups: pick one option value. For YES/NO questions, pick "yes".
   - checkboxes: Terms/consent/privacy → value:"true". Marketing opt-in → value:"false". When in doubt, value:"true".
   - fileUploads: DO NOT include fill instructions — the extension auto-uploads the resume PDF.
   - yesNoQuestions: MUST include a fill instruction for EACH unanswered yes/no question. Use the exact question label. Value must be "yes" or "no". For skills/qualification questions, pick "yes". The extension will click the correct button.
   - ariaRadioGroups (Google Forms single-choice): MUST include a fill instruction for EACH group that has no currentValue. Use the exact question label. Value must be the EXACT text of one option from the options list. The extension clicks the matching radio option.
   - ariaCheckboxGroups (Google Forms multi-choice): MUST include a fill instruction for EACH group that has no currentValue. Use the exact question label. Value should be the EXACT text of the most appropriate option(s) — comma-separated if multiple apply (e.g. "LinkedIn, Job board"). The extension clicks each matching checkbox.
   - Education/Experience fields (school, degree, company, job title, start/end dates): fill using DEMO_USER.educationHistory[0] and DEMO_USER.workExperience[0].
   - Every fill instruction must include: label AND (name OR id if available), value, source.
   - Review page (totalVisibleInputs=0, submit button visible): return fills:[] — extension clicks Submit automatically.

3. "navigate" — ONLY if pure listing page with NO applyButtons and NO form visible.
   - Use a real URL from navigationLinks. NEVER invent a URL.

4. "done" — ONLY if the current page is a confirmation/thank-you page proving the application was received.
   - Look for text like "Thank you for applying", "Application submitted", "Application received", "We've received your application", "You've successfully applied", etc.
   - Do NOT return "done" just because a submit button was clicked — wait for an explicit confirmation message.

Key rules:
- applyButtons non-empty → always "click"
- Any page with a form → always "fill" every single visible field including all customSelects
- Pure listing with no form and no applyButtons → "navigate"
- Confirmation/thank-you page → always "done"

Respond with ONLY valid JSON, no markdown:
Fill: {"action":"fill","reason":"...","fills":[{"label":"Qualification","value":"Master's Degree","source":"demo_user"},{"label":"Areas of Expertise Sought","value":"Software Engineering","source":"ai_generated"},...]}
Click: {"action":"click","reason":"...","buttonText":"Apply now"}
Navigate: {"action":"navigate","reason":"...","url":"https://..."}
Done: {"action":"done","reason":"Application confirmed — page shows 'Thank you for applying'"}`;
}

export async function geminiPost(apiKey: string, body: object, retries = 3): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status !== 429 || attempt === retries) return res;
    const delay = 5000 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error("Gemini rate limit — all retries exhausted");
}

export async function callGemini(apiKey: string, data: JobData): Promise<Decision> {
  const res = await geminiPost(apiKey, {
    contents: [{ parts: [{ text: buildPrompt(data) }] }],
    generationConfig: { responseMimeType: "application/json" },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `Gemini API error ${res.status}`);
  }
  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty response from Gemini");
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(text) as Decision;
  } catch {
    throw new Error(`Could not parse Gemini response: ${text.slice(0, 120)}`);
  }
}

export async function callGeminiForRemaining(
  apiKey: string,
  fields: UnfilledField[],
  pageText: string,
): Promise<FillInstruction[]> {
  const prompt = `You are a job application assistant. These required form fields are still empty after the initial fill pass. Generate ONE fill value for EACH field.

JOB PAGE CONTEXT:
${pageText || "(not available)"}

DEMO USER DATA:
${JSON.stringify(DEMO_USER, null, 2)}

UNFILLED REQUIRED FIELDS:
${JSON.stringify(fields, null, 2)}

Rules:
- custom_select: options[] lists the ACTUAL available options from the dropdown. You MUST pick ONE value EXACTLY as written in the options array. Do NOT invent a value.
- yes_no: value must be exactly "yes" or "no". For skills/qualification questions pick "yes".
- radio: pick the most appropriate option from the options array. For YES/NO, pick "yes".
- select: pick the most appropriate non-empty option value from options array.
- textarea / text: generate a concise, relevant answer based on job context and demo user.
- invalid: re-supply the correct value for the failed field.
- Include label AND (name or id) when provided.
- source must be "ai_generated".

Respond with ONLY a valid JSON array, no markdown:
[{"label":"Qualification","name":"CA_21168","value":"Bachelor's Degree","source":"ai_generated"}, ...]`;

  const res = await geminiPost(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" },
  });
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
