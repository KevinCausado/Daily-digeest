import { useState, useRef, useEffect } from "react";

const API_KEY = "AQ.Ab8RN6KDe-v93aFVgFxYipFcu9is4zuMpCp_VjjcHiZoGkRMqw";

const TOPICS = [
  { id: "trading", label: "Trading / Finanzas", emoji: "📈" },
  { id: "ai", label: "AI / Tech / Dev", emoji: "🤖" },
  { id: "fitness", label: "Fitness / Biomecatronica", emoji: "💪" },
  { id: "negocios", label: "Negocios Digitales", emoji: "🏢" },
  { id: "psicologia", label: "Psicologia / Dev Personal", emoji: "🧠" },
  { id: "salud", label: "Salud / Longevidad", emoji: "🩺" },
  { id: "esoterismo", label: "Esoterismo / Transmutacion", emoji: "✨" },
  { id: "roleplay", label: "Roleplay AI", emoji: "🎭" },
  { id: "crypto", label: "Crypto / Web3", emoji: "₿" },
  { id: "noticias", label: "Noticias Mundo", emoji: "🌍" },
  { id: "colombia", label: "Colombia + Barranquilla", emoji: "🇨🇴" },
];

const today = new Date().toLocaleDateString("es-CO", {
  weekday: "long", day: "2-digit", month: "long", year: "numeric",
});

const systemPrompt = `Eres un analista de primer nivel. El usuario esta en Barranquilla, Colombia. Fecha: ${today}.
Genera 3-5 items con noticias actuales. Cada item: titular breve, resumen 1 linea, y al final la seccion "Fuentes" con enlaces reales separados por linea.
Usa busqueda web obligatoriamente. No inventes nada. Responde SOLO el contenido del tema solicitado, sin introducciones ni despedidas.`;

function renderItem(text) {
  const lines = text.split("\n").filter(Boolean);
  return lines.map((line, i) => {
    if (line.startsWith("🔗")) {
      return <div key={i} style={{ marginTop: 6, fontSize: 12, color: "#a78bfa", lineHeight: 1.6 }}>{line}</div>;
    }
    if (line.startsWith("•") || line.startsWith("-")) {
      return <div key={i} style={{ marginBottom: 4, color: "#ccc", fontSize: 13, lineHeight: 1.6 }}>{line}</div>;
    }
    return <div key={i} style={{ marginBottom: 10, color: "#e0e0e0", fontSize: 13, lineHeight: 1.6 }}>{line}</div>;
  });
}

export default function App() {
  const [selected, setSelected] = useState(() => new Set(TOPICS.map((t) => t.id)));
  const [status, setStatus] = useState("idle");
  const [topicResults, setTopicResults] = useState({});
  const [topicStatus, setTopicStatus] = useState({});
  const [searchLog, setSearchLog] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [filter, setFilter] = useState("");
  const abortRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [searchLog]);

  const toggle = (id) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    setSelected(selected.size === TOPICS.length ? new Set() : new Set(TOPICS.map((t) => t.id)));
  };

  const stop = () => {
    if (abortRef.current) abortRef.current.abort();
    setStatus("done");
  };

  const fetchWithRetry = async (url, options, retries = 3, delay = 2000) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status === 429 && attempt < retries) {
        const wait = delay * attempt;
        setSearchLog((prev) => [...prev, `Cuota excedida, reintentando en ${wait/1000}s (intento ${attempt}/${retries})`]);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      const errText = await res.text().catch(() => "");
      setSearchLog((prev) => [...prev, `Error ${res.status}: ${errText.slice(0, 200)}`]);
      throw new Error(`API error ${res.status}`);
    }
    throw new Error("API error 429 - cuota agotada tras reintentos");
  };

  const fetchTopic = async (topic, ctrl) => {
    const label = topic.label;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${API_KEY}`;

    setTopicStatus((prev) => ({ ...prev, [topic.id]: "searching" }));
    setSearchLog((prev) => [...prev, `Buscando: ${label}`]);

    const res = await fetchWithRetry(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            parts: [
              {
                text: `Genera el briefing de "${label}" para hoy. Incluye noticias globales y de Colombia/Barranquilla si aplican.`,
              },
            ],
          },
        ],
        tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: 800 },
      }),
    });

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const ev = JSON.parse(raw);
          const candidates = ev.candidates;
          if (!candidates) continue;

          for (const c of candidates) {
            const parts = c.content?.parts || [];
            for (const p of parts) {
              if (p.text) {
                fullText += p.text;
                setTopicResults((prev) => ({ ...prev, [topic.id]: fullText }));
              }
            }

            const meta = c.groundingMetadata;
            if (meta?.groundingChunks) {
              for (const chunk of meta.groundingChunks) {
                const title = chunk.web?.title || "";
                const uri = chunk.web?.uri || "";
                if (title && uri) {
                  setSearchLog((prev) => {
                    const exists = prev.some((p) => p.includes(uri));
                    if (exists) return prev;
                    return [...prev, `${title} - ${uri}`];
                  });
                }
              }
            }
          }
        } catch {}
      }
    }

    if (!fullText.trim()) {
      setTopicStatus((prev) => ({ ...prev, [topic.id]: "error" }));
      setSearchLog((prev) => [...prev, `Sin contenido devuelto para ${label}`]);
      return;
    }

    setTopicStatus((prev) => ({ ...prev, [topic.id]: "done" }));
    setSearchLog((prev) => [...prev, `${label} completado`]);
  };

  const generate = async () => {
    if (selected.size === 0) return;
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setStatus("loading");
    setTopicResults({});
    setTopicStatus({});
    setSearchLog([]);

    const topicList = TOPICS.filter((t) => selected.has(t.id));
    setProgress({ done: 0, total: topicList.length });

    for (let i = 0; i < topicList.length; i++) {
      if (ctrl.signal.aborted) break;
      setTopicStatus((prev) => ({ ...prev, [topicList[i].id]: "searching" }));
      try {
        await fetchTopic(topicList[i], ctrl);
      } catch (e) {
        if (e.name !== "AbortError") {
          setTopicStatus((prev) => ({ ...prev, [topicList[i].id]: "error" }));
          const msg = e.message || "";
          setSearchLog((prev) => [...prev, `Error en ${topicList[i].label}: ${msg}`]);
        }
      }
      setProgress({ done: i + 1, total: topicList.length });
      if (i < topicList.length - 1 && !ctrl.signal.aborted) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    setStatus("done");
  };

  const filteredTopics = TOPICS.filter((t) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return t.label.toLowerCase().includes(q) || t.id.includes(q);
  });

  return (
    <div
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        padding: "24px",
        fontFamily: "system-ui, sans-serif",
        color: "#e0e0e0",
      }}
    >
      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }
        @keyframes slideIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "linear-gradient(135deg,#7c3aed,#a78bfa)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
          >
            📋
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>Daily Digest</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 1 }}>
              Actualidad curada por IA
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {status === "loading" && (
            <div
              style={{
                fontSize: 11,
                color: "#f59e0b",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#f59e0b",
                  animation: "pulse 1s infinite",
                }}
              />
              {progress.done}/{progress.total} temas
            </div>
          )}
          <div
            style={{
              border: "1px solid #222",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 11,
              color: "#666",
              textTransform: "uppercase",
              letterSpacing: "0.3px",
              whiteSpace: "nowrap",
            }}
          >
            {today}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Buscar temas..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            background: "#111",
            border: "1px solid #222",
            borderRadius: 8,
            padding: "8px 12px",
            color: "#ccc",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          onClick={toggleAll}
          style={{
            background: "transparent",
            border: "1px solid #222",
            borderRadius: 8,
            padding: "8px 14px",
            color: "#888",
            cursor: "pointer",
            fontSize: 12,
            whiteSpace: "nowrap",
          }}
        >
          {selected.size === TOPICS.length ? "☐ Todos" : "☑ Todos"}
        </button>
        {status === "loading" ? (
          <button
            onClick={stop}
            style={{
              background: "#1a0a0a",
              border: "1px solid #7f1d1d",
              borderRadius: 8,
              padding: "8px 18px",
              color: "#f87171",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            ⏹ Detener
          </button>
        ) : (
          <button
            onClick={generate}
            disabled={selected.size === 0}
            style={{
              background:
                selected.size > 0 ? "linear-gradient(135deg,#7c3aed,#6d28d9)" : "#111",
              border: "none",
              borderRadius: 8,
              padding: "8px 18px",
              color: selected.size > 0 ? "#fff" : "#333",
              cursor: selected.size > 0 ? "pointer" : "not-allowed",
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              opacity: selected.size > 0 ? 1 : 0.5,
            }}
          >
            ⚡ Generar
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 20,
        }}
      >
        {TOPICS.map((t) => {
          const on = selected.has(t.id);
          const ts = topicStatus[t.id];
          let indicator = null;
          if (ts === "searching")
            indicator = (
              <span style={{ fontSize: 10, marginLeft: 4, color: "#f59e0b" }}>⟳</span>
            );
          else if (ts === "done")
            indicator = (
              <span style={{ fontSize: 10, marginLeft: 4, color: "#22c55e" }}>✓</span>
            );
          else if (ts === "error")
            indicator = (
              <span style={{ fontSize: 10, marginLeft: 4, color: "#ef4444" }}>✗</span>
            );

          return (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              style={{
                background: on ? "#1a1040" : "#111",
                border: `1px solid ${on ? "#7c3aed" : "#222"}`,
                borderRadius: 20,
                padding: "5px 12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                color: on ? "#c4b5fd" : "#666",
                transition: "all 0.15s",
              }}
            >
              <span>{t.emoji}</span>
              <span style={{ whiteSpace: "nowrap" }}>{t.label}</span>
              {indicator}
            </button>
          );
        })}
      </div>

      {(status === "loading" || (status === "done" && searchLog.length > 0)) && (
        <div
          ref={logRef}
          style={{
            background: "#0d0d0d",
            border: "1px solid #1a1a1a",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 20,
            maxHeight: 120,
            overflowY: "auto",
          }}
        >
          {searchLog.map((entry, i) => (
            <div
              key={i}
              style={{
                fontSize: 11,
                color: "#666",
                fontFamily: "monospace",
                padding: "1px 0",
                animation: "slideIn 0.2s ease",
              }}
            >
              {entry}
            </div>
          ))}
          {status === "loading" && (
            <div style={{ fontSize: 11, color: "#444", fontFamily: "monospace", marginTop: 4 }}>
              Procesando...
            </div>
          )}
        </div>
      )}

      {status === "idle" && Object.keys(topicResults).length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#2a2a2a" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📜</div>
          <div style={{ fontSize: 13, color: "#444" }}>
            Selecciona los temas y pulsa Generar
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
          gap: 12,
        }}
      >
        {filteredTopics.map((topic) => {
          const content = topicResults[topic.id];
          const ts = topicStatus[topic.id];
          if (!content && ts !== "searching" && ts !== "error") return null;

          let statusColor = "#222";
          let statusIcon = "";
          if (ts === "searching") {
            statusColor = "#f59e0b";
            statusIcon = "⟳";
          } else if (ts === "done") {
            statusColor = "#22c55e";
            statusIcon = "✓";
          } else if (ts === "error") {
            statusColor = "#ef4444";
            statusIcon = "✗";
          }

          const itemCount = content
            ? content.split("\n").filter((l) => l.startsWith("•") || l.startsWith("-")).length
            : 0;

          return (
            <div
              key={topic.id}
              style={{
                background: "#111",
                border: `1px solid ${statusColor}20`,
                borderRadius: 12,
                padding: 0,
                overflow: "hidden",
                animation: "slideIn 0.3s ease",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderBottom: "1px solid #1a1a1a",
                  background:
                    ts === "searching" ? "linear-gradient(135deg,#1a1040,#111)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{topic.emoji}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                    {topic.label}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {itemCount > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "#666",
                        background: "#1a1a1a",
                        padding: "2px 8px",
                        borderRadius: 10,
                      }}
                    >
                      {itemCount} items
                    </span>
                  )}
                  <span style={{ fontSize: 14, color: statusColor }}>{statusIcon}</span>
                </div>
              </div>

              <div style={{ padding: "12px 16px" }}>
                {ts === "searching" && !content && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      color: "#666",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        animation: "spin 1s linear infinite",
                        display: "inline-block",
                      }}
                    >
                      ◌
                    </span>
                    Buscando y analizando...
                  </div>
                )}
                {ts === "error" && !content && (
                  <div style={{ color: "#ef4444", fontSize: 12 }}>Error al obtener datos</div>
                )}
                {content && (
                  <div style={{ fontSize: 13, lineHeight: 1.7 }}>{renderItem(content)}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
