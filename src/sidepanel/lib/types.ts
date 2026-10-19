export type FieldInfo = {
  label: string;
  name?: string;
  id?: string;
  required?: boolean;
  visible?: boolean;
  value?: string;
  href?: string;
  options?: string[];
};

export type JobData = {
  url: string;
  title: string;
  pageText?: string;
  totals: Record<string, number>;
  detectedActionButton?: { text: string; isFinal: boolean } | null;
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
    customSelects?: FieldInfo[];
    yesNoQuestions?: FieldInfo[];
    hiddenInputs: FieldInfo[];
    ariaRadioGroups?: FieldInfo[];
    ariaCheckboxGroups?: FieldInfo[];
  };
};

export type FillInstruction = {
  name?: string;
  id?: string;
  label?: string;
  value: string;
  source?: string;
};

export type Decision =
  | { action: "fill"; reason: string; fills: FillInstruction[] }
  | { action: "navigate"; reason: string; url: string }
  | { action: "click"; reason: string; buttonText: string }
  | { action: "done"; reason: string };

export type FillReportItem = {
  label: string;
  value: string;
  source: string;
  status: string;
};

export type UnfilledField = {
  label: string;
  name?: string;
  id?: string;
  type: string;
  options?: string[];
};

export type SubmitResult = {
  filled: number;
  submitted: boolean;
  pageAction: "submitted" | "continued" | "none";
  actionButtonText?: string | null;
  report: FillReportItem[];
  url: string;
  title: string;
  unfilledRequired?: UnfilledField[];
};

export type Phase = "idle" | "running" | "done" | "error";
