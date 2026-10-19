import { useEffect, useRef, useState } from "react";
import type { Phase, SubmitResult, FillInstruction, JobData } from "../lib/types";
import { callGemini, callGeminiForRemaining, countVisibleInputs } from "../lib/gemini";

export interface AutoApplyState {
  phase: Phase;
  logs: string[];
  jobInfo: { title: string; company: string } | null;
  submitResult: SubmitResult | null;
  navCount: number;
  continueCount: number;
}

export interface AutoApplyActions {
  startAutoApply: () => Promise<void>;
  stop: () => void;
  clearLogs: () => void;
}

const MAX_NAV = 8;
const MAX_CONTINUE = 10;

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
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message ?? "Unknown")); return; }
      const r = response as { error?: string } & SubmitResult;
      if (r.error) { reject(new Error(r.error)); return; }
      resolve(r);
    });
  });
}

function doFillFields(fills: FillInstruction[]): Promise<SubmitResult> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "FILL_AND_SUBMIT", fills, submitForm: false }, (response) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message ?? "Unknown")); return; }
      const r = response as { error?: string } & SubmitResult;
      if (r.error) { reject(new Error(r.error)); return; }
      resolve(r);
    });
  });
}

function expandProfileSections(): Promise<{ expanded: number }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "EXPAND_PROFILE_SECTIONS" }, (response) => {
      if (chrome.runtime.lastError) { resolve({ expanded: 0 }); return; }
      resolve((response as { expanded: number }) ?? { expanded: 0 });
    });
  });
}

export function useAutoApply(apiKey: string): AutoApplyState & AutoApplyActions {
  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [jobInfo, setJobInfo] = useState<{ title: string; company: string } | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [navCount, setNavCount] = useState(0);
  const [continueCount, setContinueCount] = useState(0);

  const isRunningRef     = useRef(false);
  const isExecutingRef   = useRef(false);
  const navCountRef      = useRef(0);
  const continueCountRef = useRef(0);
  const apiKeyRef        = useRef("");
  const runCycleRef      = useRef<(() => Promise<void>) | null>(null);
  const clickFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep apiKeyRef always current
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);

  function log(msg: string) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log("[SP]", msg);
    setLogs((prev) => [...prev, entry]);
  }

  // Background message listener
  useEffect(() => {
    const handler = (message: unknown) => {
      const msg = message as { type?: string };

      if (msg.type === "TAB_READY") {
        if (!isRunningRef.current) return;
        if (clickFallbackTimerRef.current) {
          clearTimeout(clickFallbackTimerRef.current);
          clickFallbackTimerRef.current = null;
        }
        log("← Page loaded — re-analyzing in 1s...");
        setTimeout(() => runCycleRef.current?.(), 1000);
        return;
      }

      if (msg.type === "START_AUTO_APPLY") {
        const job = msg as { title?: string; company?: string };
        const title   = job.title   ?? "Job";
        const company = job.company ?? "";
        setJobInfo({ title, company });
        setSubmitResult(null);
        setLogs([]);

        if (apiKeyRef.current.trim()) {
          isRunningRef.current    = true;
          isExecutingRef.current  = false;
          navCountRef.current     = 0;
          continueCountRef.current = 0;
          setNavCount(0);
          setContinueCount(0);
          setPhase("running");
          log("Auto Apply started — waiting for page to load...");
          setTimeout(() => {
            if (isRunningRef.current && !isExecutingRef.current) {
              runCycleRef.current?.();
            }
          }, 3000);
        } else {
          log(`Job queued: ${title}. Enter your Gemini API key above, then click Auto Apply.`);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // Keep runCycleRef up-to-date after every render
  useEffect(() => {
    runCycleRef.current = runCycle;
  });

  function stop() {
    isRunningRef.current   = false;
    isExecutingRef.current = false;
    setPhase("idle");
    log("Stopped.");
  }

  function clearLogs() {
    setLogs([]);
  }

  async function runCycle() {
    if (!isRunningRef.current || isExecutingRef.current) return;
    isExecutingRef.current = true;

    try {
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
      if (elements.detectedActionButton) {
        const btn = elements.detectedActionButton;
        log(`   Action button: "${btn.text}" (${btn.isFinal ? "FINAL SUBMIT" : "continue/next"})`);
      } else {
        log(`   Action button: none detected`);
      }

      log("→ Asking Gemini...");
      const decision = await callGemini(apiKeyRef.current, elements);
      log(`← Gemini: ${decision.action.toUpperCase()} — ${decision.reason}`);

      if (decision.action === "navigate") {
        if (navCountRef.current >= MAX_NAV) {
          throw new Error(`Reached max ${MAX_NAV} navigations without finding a form.`);
        }
        const url = decision.url;
        if (!url || url === "null") throw new Error("Gemini returned no valid URL to navigate to.");
        navCountRef.current++;
        setNavCount(navCountRef.current);
        log(`→ Navigating [${navCountRef.current}/${MAX_NAV}]: ${url}`);
        chrome.runtime.sendMessage({ type: "NAVIGATE", url });

      } else if (decision.action === "click") {
        if (navCountRef.current >= MAX_NAV) {
          throw new Error(`Reached max ${MAX_NAV} navigations without finding a form.`);
        }
        navCountRef.current++;
        setNavCount(navCountRef.current);

        const clickText = decision.buttonText.toLowerCase();
        const matchedBtn = elements.categories.applyButtons.find((b) => {
          const t = (b.value ?? b.href ?? "").toLowerCase();
          return t.includes(clickText) || clickText.includes(t);
        });

        if (matchedBtn?.href) {
          log(`→ Navigating to apply URL [${navCountRef.current}/${MAX_NAV}]: ${matchedBtn.href}`);
          chrome.runtime.sendMessage({ type: "NAVIGATE", url: matchedBtn.href });
        } else {
          log(`→ Clicking button [${navCountRef.current}/${MAX_NAV}]: "${decision.buttonText}"`);
          chrome.runtime.sendMessage({ type: "WATCH_FOR_NEW_TAB" });
          chrome.runtime.sendMessage({ type: "CLICK_BUTTON", buttonText: decision.buttonText });
          clickFallbackTimerRef.current = setTimeout(() => {
            clickFallbackTimerRef.current = null;
            if (isRunningRef.current) {
              log("← No navigation detected — re-analyzing page...");
              runCycleRef.current?.();
            }
          }, 3000);
        }

      } else if (decision.action === "done") {
        setPhase("done");
        isRunningRef.current = false;
        log(`✓ ${decision.reason}`);

      } else {
        // fill
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

        let allFills = [...decision.fills];
        if (unfilled.length > 0) {
          log(`→ ${unfilled.length} required field(s) still empty after pass 1:`);
          for (const f of unfilled) {
            log(`   [?] "${f.label}" (${f.type}${f.options?.length ? ": " + f.options.join(" | ") : ""})`);
          }
          log("→ Asking Gemini to generate values for remaining fields...");
          const additionalFills = await callGeminiForRemaining(apiKeyRef.current, unfilled, elements.pageText ?? "");
          log(`← Generated ${additionalFills.length} additional fill(s)`);
          for (const f of additionalFills) {
            log(`   [AI] "${f.label ?? f.name ?? f.id}" = "${f.value}"`);
          }
          allFills = [...allFills, ...additionalFills];
        }

        const result = await doFillAndSubmit(allFills);

        if (result.actionButtonText) {
          log(`← Action button clicked: "${result.actionButtonText}"`);
        } else {
          log(`← No action button found on page (check browser console for details)`);
        }

        if (result.pageAction === "continued") {
          if (continueCountRef.current >= MAX_CONTINUE) {
            throw new Error(`Reached max ${MAX_CONTINUE} form pages without final submission.`);
          }
          continueCountRef.current++;
          setContinueCount(continueCountRef.current);
          log(`→ Clicked Continue [page ${continueCountRef.current}/${MAX_CONTINUE}] — waiting for next page...`);
          chrome.runtime.sendMessage({ type: "WATCH_CURRENT_TAB" });
          clickFallbackTimerRef.current = setTimeout(() => {
            clickFallbackTimerRef.current = null;
            if (isRunningRef.current) {
              log("← No navigation — re-analyzing (validation error or same-page update)...");
              runCycleRef.current?.();
            }
          }, 3500);

        } else if (result.pageAction === "submitted") {
          log("→ Submit clicked — waiting for confirmation page...");
          chrome.runtime.sendMessage({ type: "WATCH_CURRENT_TAB" });
          clickFallbackTimerRef.current = setTimeout(() => {
            clickFallbackTimerRef.current = null;
            if (isRunningRef.current) {
              log("← Re-scanning to verify submission...");
              runCycleRef.current?.();
            }
          }, 3500);

        } else if (result.pageAction === "none" && (result.unfilledRequired?.length ?? 0) > 0) {
          const unfillable = result.unfilledRequired!.filter((f) => f.type === "gforms_file_upload");
          const fillable   = result.unfilledRequired!.filter((f) => f.type !== "gforms_file_upload");

          if (unfillable.length > 0 && fillable.length === 0) {
            setPhase("done");
            isRunningRef.current = false;
            log("⚠ All other fields filled. The form has a required Google Drive file upload which cannot be automated — please attach your CV manually then submit.");
            for (const f of unfillable) log(`   [file] "${f.label}"`);
            return;
          }

          log(`← Submit failed — ${result.unfilledRequired!.length} issue(s). Re-scanning...`);
          for (const f of result.unfilledRequired!) {
            log(`   [!] "${f.label}" (${f.type}${f.options?.length ? ": " + f.options.slice(0, 5).join(" | ") : ""})`);
          }
          clickFallbackTimerRef.current = setTimeout(() => {
            clickFallbackTimerRef.current = null;
            if (isRunningRef.current) runCycleRef.current?.();
          }, 1500);

        } else {
          setSubmitResult(result);
          setPhase("done");
          isRunningRef.current = false;
          log(`✓ Done (no submit button found). Filled ${result.filled} field(s).`);
        }
      }
    } catch (err) {
      isRunningRef.current = false;
      setPhase("error");
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${msg}`);
    } finally {
      isExecutingRef.current = false;
    }
  }

  async function startAutoApply() {
    if (!apiKeyRef.current.trim()) { log("✗ No API key set."); return; }
    isRunningRef.current = true;
    navCountRef.current = 0;
    continueCountRef.current = 0;
    setNavCount(0);
    setContinueCount(0);
    setSubmitResult(null);
    setLogs([]);
    setPhase("running");
    log("Auto Apply started.");
    await runCycle();
  }

  return { phase, logs, jobInfo, submitResult, navCount, continueCount, startAutoApply, stop, clearLogs };
}
