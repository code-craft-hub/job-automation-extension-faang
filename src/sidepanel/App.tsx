import { useEffect, useState } from "react";

type ElementData = {
  total: number;
  tags: [string, number][];
};

export default function App() {
  const [data, setData] = useState<ElementData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_ELEMENTS" }, (response) => {
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
  if (!data) return <pre>Loading...</pre>;

  return (
    <pre>
      Total elements: {data.total}
      {"\n\n"}
      {data.tags.map(([tag, count]) => `${tag}: ${count}`).join("\n")}
    </pre>
  );
}
