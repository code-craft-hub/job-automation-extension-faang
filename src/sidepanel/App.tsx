import { useEffect, useState } from "react";

type ElementInfo = {
  tag: string;
  type?: string;
  label: string;
  name?: string;
  required: boolean;
  visible: boolean;
  href?: string;
  value?: string;
  options?: string[];
};

type HiddenInput = { name: string; id?: string; value?: string };

type JobData = {
  url: string;
  title: string;
  totals: Record<string, number>;
  categories: {
    textFields: ElementInfo[];
    dateFields: ElementInfo[];
    fileUploads: ElementInfo[];
    checkboxes: ElementInfo[];
    radios: ElementInfo[];
    dropdowns: (ElementInfo & { options: string[] })[];
    textareas: ElementInfo[];
    buttons: ElementInfo[];
    navigationLinks: ElementInfo[];
    richTextEditors: ElementInfo[];
    customComponents: ElementInfo[];
    hiddenInputs: HiddenInput[];
  };
};

const CATEGORY_LABELS: Record<string, string> = {
  textFields: "TEXT INPUTS",
  dateFields: "DATE / TIME INPUTS",
  fileUploads: "FILE UPLOADS",
  checkboxes: "CHECKBOXES",
  radios: "RADIO BUTTONS",
  dropdowns: "DROPDOWNS",
  textareas: "TEXT AREAS",
  buttons: "BUTTONS",
  navigationLinks: "JOB NAVIGATION LINKS",
  richTextEditors: "RICH TEXT EDITORS",
  customComponents: "CUSTOM ARIA COMPONENTS",
  hiddenInputs: "HIDDEN INPUTS",
};

function formatEl(el: ElementInfo): string {
  const parts: string[] = [`<${el.tag}${el.type ? `[${el.type}]` : ""}>`];
  if (el.label) parts.push(`"${el.label}"`);
  if (el.name && el.name !== el.label) parts.push(`name="${el.name}"`);
  if (el.required) parts.push("*required*");
  if (!el.visible) parts.push("(hidden)");
  if (el.options?.length) {
    const preview = el.options.slice(0, 4).join(" | ");
    const more = el.options.length > 4 ? ` +${el.options.length - 4}` : "";
    parts.push(`[${preview}${more}]`);
  }
  if (el.href) parts.push(`→ ${el.href}`);
  else if (el.value) parts.push(`= ${el.value}`);
  return "  " + parts.join(" ");
}

export default function App() {
  const [data, setData] = useState<JobData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_JOB_ELEMENTS" }, (response) => {
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message ?? "Unknown error");
        return;
      }
      if (response?.error) {
        setError(response.error);
        return;
      }
      setData(response);
    });
  }, []);

  if (error) return <pre>Error: {error}</pre>;
  if (!data) return <pre>Scanning for job elements...</pre>;

  const lines: string[] = [
    `PAGE:  ${data.title}`,
    `URL:   ${data.url}`,
    "",
    "── SUMMARY ──────────────────────────",
    ...Object.entries(data.totals)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `  ${CATEGORY_LABELS[k] ?? k}: ${v}`),
    "",
  ];

  for (const key of Object.keys(CATEGORY_LABELS)) {
    const items = data.categories[key as keyof typeof data.categories];
    if (!items.length) continue;
    lines.push(`── ${CATEGORY_LABELS[key]} (${items.length}) ──`);
    if (key === "hiddenInputs") {
      for (const h of items as HiddenInput[]) {
        lines.push(`  name="${h.name}"${h.value ? ` value="${h.value}"` : ""}`);
      }
    } else {
      for (const el of items as ElementInfo[]) {
        lines.push(formatEl(el));
      }
    }
    lines.push("");
  }

  return (
    <pre
      style={{
        fontSize: "11px",
        padding: "8px",
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {lines.join("\n")}
    </pre>
  );
}
