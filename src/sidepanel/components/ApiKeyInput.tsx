interface Props {
  value: string;
  onChange: (key: string) => void;
}

export function ApiKeyInput({ value, onChange }: Props) {
  return (
    <div className="sp-section">
      <div className="sp-section-label">Gemini API Key</div>
      <input
        type="password"
        className="sp-input"
        placeholder="Paste your API key here..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {!value.trim() && (
        <p className="sp-input-hint">
          Get a free key at{" "}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
            aistudio.google.com
          </a>
        </p>
      )}
    </div>
  );
}
