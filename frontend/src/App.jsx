import { useState, useEffect } from "react";
import axios from "axios";

const API = "http://localhost:8000";
const STORAGE_KEY = "rag_ingestion_history";

// ─────────────────────────────────────────────
// LocalStorage helpers — yahan history "yaad" rehti hai
// ─────────────────────────────────────────────
function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

// ─────────────────────────────────────────────
// Step definitions — yeh order mein dikhenge
// ─────────────────────────────────────────────
const STEP_DEFS = [
  {
    key: "extract_text_ms",
    label: "Extract Text",
    desc: (r) => `Extracted text from ${r?.pages ?? "—"} page(s).`,
  },
  {
    key: "chunking_ms",
    label: "Chunk Text",
    desc: (r) => `Created ${r?.chunks ?? "—"} chunk(s).`,
  },
  {
    key: "embedding_ms",
    label: "Generate Embeddings",
    desc: (r) =>
      `TF-IDF vectors over ${r?.vocabulary_size ?? "—"} word vocabulary.`,
  },
  {
    key: "storage_ms",
    label: "Store in PostgreSQL",
    desc: () => `Chunks and vectors saved to database.`,
  },
];

function fmtMs(ms) {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Score ko 0-100% mein dikhane ke liye, aur color decide karne ke liye
function scoreMeta(score) {
  const pct = Math.round(score * 100);
  let tone = "low";
  if (score >= 0.3) tone = "high";
  else if (score >= 0.12) tone = "mid";
  return { pct, tone };
}

export default function App() {
  const [view, setView] = useState("upload"); // upload | history | search | chunks
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [activeChunks, setActiveChunks] = useState(null);
  const [chunksLoading, setChunksLoading] = useState(false);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setCurrent(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post(`${API}/upload`, formData);
      const data = res.data;

      const record = {
        id: `${Date.now()}`,
        file_name: data.file_name,
        chunks: data.chunks,
        vocabulary_size: data.vocabulary_size,
        total_time_ms: data.total_time_ms,
        step_timings_ms: data.step_timings_ms,
        uploaded_at: new Date().toISOString(),
        status: "completed",
      };

      setCurrent(record);
      setHistory((prev) => [record, ...prev].slice(0, 50));
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    }

    setLoading(false);
  };

  const openChunks = async (sourceName) => {
    setChunksLoading(true);
    setView("chunks");
    setActiveChunks({ source: sourceName, chunks: [] });
    try {
      const res = await axios.get(
        `${API}/documents/${encodeURIComponent(sourceName)}/chunks`,
      );
      setActiveChunks({ source: sourceName, chunks: res.data });
    } catch {
      setActiveChunks({ source: sourceName, chunks: [], error: true });
    }
    setChunksLoading(false);
  };

  const clearHistory = () => {
    if (
      confirm(
        "Clear all ingestion history? This only clears the local log, not the database.",
      )
    ) {
      setHistory([]);
    }
  };

  return (
    <div style={styles.page}>
      <style>{globalCss}</style>

      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.brandMark}>◧</span>
          <span>Document Ingestion</span>
        </div>
        <nav style={styles.nav}>
          <button
            style={view === "upload" ? styles.navBtnActive : styles.navBtn}
            onClick={() => setView("upload")}
          >
            Upload
          </button>
          <button
            style={view === "search" ? styles.navBtnActive : styles.navBtn}
            onClick={() => setView("search")}
          >
            Search
          </button>
          <button
            style={view === "history" ? styles.navBtnActive : styles.navBtn}
            onClick={() => setView("history")}
          >
            History ({history.length})
          </button>
        </nav>
      </header>

      <main style={styles.main}>
        {view === "upload" && (
          <UploadView
            file={file}
            setFile={setFile}
            loading={loading}
            error={error}
            current={current}
            onUpload={handleUpload}
            onViewChunks={openChunks}
          />
        )}

        {view === "search" && <SearchView />}

        {view === "history" && (
          <HistoryView
            history={history}
            onViewChunks={openChunks}
            onClear={clearHistory}
          />
        )}

        {view === "chunks" && (
          <ChunksView
            data={activeChunks}
            loading={chunksLoading}
            onBack={() => setView(history.length ? "history" : "upload")}
          />
        )}
      </main>
    </div>
  );
}

// ═══════════════════════════════════════════════
// SEARCH VIEW — naya tab, retrieval test karne ke liye
// ═══════════════════════════════════════════════
function SearchView() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [recentQueries, setRecentQueries] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("rag_recent_queries") || "[]");
    } catch {
      return [];
    }
  });

  const runSearch = async (q) => {
    const text = (q ?? query).trim();
    if (!text) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await axios.post(`${API}/search`, {
        query: text,
        top_k: topK,
      });
      setResult(res.data);

      const updated = [text, ...recentQueries.filter((r) => r !== text)].slice(
        0,
        8,
      );
      setRecentQueries(updated);
      localStorage.setItem("rag_recent_queries", JSON.stringify(updated));
    } catch (err) {
      setError(err.response?.data?.detail || err.message);
    }

    setLoading(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.pageHead}>
        <div>
          <h1 style={styles.h1}>Search documents</h1>
          <p style={styles.sub}>
            Query the stored chunks using TF-IDF + cosine similarity.
          </p>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.searchRow}>
          <input
            style={styles.searchInput}
            type="text"
            placeholder="e.g. What is chunking stage and duplicate detection?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
          />
          <select
            style={styles.topKSelect}
            value={topK}
            onChange={(e) => setTopK(Number(e.target.value))}
          >
            {[3, 5, 8, 10].map((n) => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
          </select>
          <button
            style={
              !query.trim() || loading
                ? styles.primaryBtnDisabled
                : styles.primaryBtnInline
            }
            disabled={!query.trim() || loading}
            onClick={() => runSearch()}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {recentQueries.length > 0 && !result && (
          <div style={styles.chipRow}>
            {recentQueries.map((q) => (
              <button
                key={q}
                style={styles.chip}
                onClick={() => {
                  setQuery(q);
                  runSearch(q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={styles.errorBox}>
          <strong>Search failed.</strong> {error}
        </div>
      )}

      {loading && (
        <div style={styles.emptyState}>
          <span style={styles.spinner} /> &nbsp; Searching {`>"`}
          {query}
          {`"`}…
        </div>
      )}

      {result && !loading && (
        <>
          <div style={styles.timingStrip}>
            <TimingPill
              label="Vocab load"
              value={fmtMs(result.timings_ms?.load_vocab_ms)}
            />
            <TimingPill
              label="Query → vector"
              value={fmtMs(result.timings_ms?.query_embedding_ms)}
            />
            <TimingPill
              label="Load chunks"
              value={fmtMs(result.timings_ms?.load_chunks_ms)}
            />
            <TimingPill
              label="Similarity search"
              value={fmtMs(result.timings_ms?.similarity_search_ms)}
            />
          </div>

          {result.results.length === 0 ? (
            <div style={styles.emptyState}>
              {result.message || "No matching chunks found for this query."}
            </div>
          ) : (
            <div style={styles.chunkList}>
              {result.results.map((r, i) => {
                const { pct, tone } = scoreMeta(r.score);
                return (
                  <div key={i} style={styles.resultCard}>
                    <div style={styles.resultHead}>
                      <span style={styles.resultRank}>#{i + 1}</span>
                      <div style={styles.scoreBarTrack}>
                        <div
                          style={{
                            ...styles.scoreBarFill,
                            width: `${Math.max(pct, 3)}%`,
                            background:
                              tone === "high"
                                ? good
                                : tone === "mid"
                                  ? "#B98900"
                                  : "#9AA1AC",
                          }}
                        />
                      </div>
                      <span style={styles.scoreLabel}>
                        {r.score.toFixed(4)}
                      </span>
                    </div>
                    <p style={styles.chunkText}>{r.text}</p>
                    <div style={styles.resultMeta}>
                      <span>{r.source}</span>
                      <span>·</span>
                      <span>chunk #{r.chunk_index}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TimingPill({ label, value }) {
  return (
    <div style={styles.timingPill}>
      <span style={styles.timingPillValue}>{value}</span>
      <span style={styles.timingPillLabel}>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════
// UPLOAD VIEW
// ═══════════════════════════════════════════════
function UploadView({
  file,
  setFile,
  loading,
  error,
  current,
  onUpload,
  onViewChunks,
}) {
  return (
    <div style={styles.container}>
      <div style={styles.pageHead}>
        <h1 style={styles.h1}>Upload a document</h1>
        <p style={styles.sub}>Watch each ingestion stage run in real time.</p>
      </div>

      <div style={styles.card}>
        <div style={styles.fieldLabel}>Select a document</div>
        <div style={styles.fieldHint}>Supported: PDF · Max 10 MB</div>

        <label style={styles.fileRow}>
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => setFile(e.target.files[0] || null)}
            style={{ display: "none" }}
          />
          <span style={styles.chooseBtn}>Choose file</span>
          <span style={styles.fileName}>
            {file ? file.name : "No file chosen"}
          </span>
        </label>

        <button
          style={
            !file || loading ? styles.primaryBtnDisabled : styles.primaryBtn
          }
          disabled={!file || loading}
          onClick={onUpload}
        >
          {loading ? "Ingesting…" : "Upload & ingest"}
        </button>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <strong>Ingestion failed.</strong> {error}
        </div>
      )}

      {loading && (
        <div style={styles.card}>
          <div style={styles.statRow}>
            <Stat label="File" value={file?.name} />
            <Stat
              label="Size"
              value={file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "—"}
            />
            <Stat
              label="Status"
              value={<span style={styles.badgeRunning}>Processing</span>}
            />
          </div>
          <div style={styles.stepGrid}>
            {STEP_DEFS.map((s) => (
              <StepCard key={s.key} label={s.label} status="running" />
            ))}
          </div>
        </div>
      )}

      {current && !loading && (
        <div style={styles.card}>
          <div style={styles.statRow}>
            <Stat label="File" value={current.file_name} />
            <Stat label="Chunks" value={current.chunks} />
            <Stat
              label="Vocabulary"
              value={`${current.vocabulary_size} words`}
            />
            <Stat label="Total time" value={fmtMs(current.total_time_ms)} />
            <Stat
              label="Status"
              value={<span style={styles.badgeDone}>Completed</span>}
            />
          </div>

          <div style={styles.stepGrid}>
            {STEP_DEFS.map((s) => (
              <StepCard
                key={s.key}
                label={s.label}
                status="done"
                time={fmtMs(current.step_timings_ms[s.key])}
                desc={s.desc(current)}
              />
            ))}
          </div>

          <button
            style={styles.linkBtn}
            onClick={() => onViewChunks(current.file_name)}
          >
            View chunks →
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// HISTORY VIEW
// ═══════════════════════════════════════════════
function HistoryView({ history, onViewChunks, onClear }) {
  return (
    <div style={styles.container}>
      <div style={styles.pageHead}>
        <div>
          <h1 style={styles.h1}>Ingestion history</h1>
          <p style={styles.sub}>
            Saved in this browser — persists across reloads.
          </p>
        </div>
        {history.length > 0 && (
          <button style={styles.dangerLink} onClick={onClear}>
            Clear history
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div style={styles.emptyState}>
          <p>No documents ingested yet.</p>
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>File</th>
                <th style={styles.th}>Chunks</th>
                <th style={styles.th}>Vocabulary</th>
                <th style={styles.th}>Extract</th>
                <th style={styles.th}>Chunk</th>
                <th style={styles.th}>Embed</th>
                <th style={styles.th}>Store</th>
                <th style={styles.th}>Total</th>
                <th style={styles.th}>Uploaded</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} style={styles.tr}>
                  <td style={styles.td}>{h.file_name}</td>
                  <td style={styles.tdCenter}>{h.chunks}</td>
                  <td style={styles.tdCenter}>{h.vocabulary_size}</td>
                  <td style={styles.tdCenter}>
                    {fmtMs(h.step_timings_ms?.extract_text_ms)}
                  </td>
                  <td style={styles.tdCenter}>
                    {fmtMs(h.step_timings_ms?.chunking_ms)}
                  </td>
                  <td style={styles.tdCenter}>
                    {fmtMs(h.step_timings_ms?.embedding_ms)}
                  </td>
                  <td style={styles.tdCenter}>
                    {fmtMs(h.step_timings_ms?.storage_ms)}
                  </td>
                  <td style={styles.tdCenter}>
                    <strong>{fmtMs(h.total_time_ms)}</strong>
                  </td>
                  <td style={styles.tdMuted}>{fmtTime(h.uploaded_at)}</td>
                  <td style={styles.tdCenter}>
                    <button
                      style={styles.linkBtnSmall}
                      onClick={() => onViewChunks(h.file_name)}
                    >
                      View →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// CHUNKS VIEW
// ═══════════════════════════════════════════════
function ChunksView({ data, loading, onBack }) {
  return (
    <div style={styles.container}>
      <button style={styles.backBtn} onClick={onBack}>
        ← Back
      </button>

      <div style={styles.pageHead}>
        <h1 style={styles.h1}>{data?.source}</h1>
        <p style={styles.sub}>
          {loading
            ? "Loading chunks…"
            : `${data?.chunks?.length ?? 0} chunk(s) stored`}
        </p>
      </div>

      {loading && <div style={styles.emptyState}>Loading…</div>}

      {!loading && data?.error && (
        <div style={styles.errorBox}>
          Could not load chunks for this document.
        </div>
      )}

      {!loading && !data?.error && (
        <div style={styles.chunkList}>
          {data?.chunks?.map((c) => (
            <div key={c.chunk_index} style={styles.chunkCard}>
              <div style={styles.chunkHead}>
                <span style={styles.chunkIndex}>Chunk #{c.chunk_index}</span>
                <span style={styles.chunkWords}>{c.word_count} words</span>
              </div>
              <p style={styles.chunkText}>{c.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Small components
// ═══════════════════════════════════════════════
function Stat({ label, value }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

function StepCard({ label, status, time, desc }) {
  const isDone = status === "done";
  return (
    <div style={styles.stepCard}>
      <div style={styles.stepCardHead}>
        <span style={styles.stepCardLabel}>{label}</span>
        {isDone ? (
          <span style={styles.badgeDone}>Completed</span>
        ) : (
          <span style={styles.badgeRunning}>Running</span>
        )}
      </div>
      {isDone ? (
        <>
          <div style={styles.stepCardTime}>{time}</div>
          <div style={styles.stepCardDesc}>{desc}</div>
        </>
      ) : (
        <div style={styles.spinnerRow}>
          <span style={styles.spinner} />
          <span style={styles.stepCardDesc}>Working…</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════
const ink = "#15181D";
const sub = "#6B7280";
const line = "#E6E8EB";
const bg = "#FAFAF9";
const accent = "#3457D5";
const good = "#1A7F4E";
const goodBg = "#E7F6EE";
const warnBg = "#FFF6E5";
const warnText = "#92660A";

const globalCss = `
  * { box-sizing: border-box; }
  body { margin: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

const styles = {
  page: {
    minHeight: "100vh",
    background: bg,
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    color: ink,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 28px",
    borderBottom: `1px solid ${line}`,
    background: "#fff",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontWeight: 600,
    fontSize: 15,
    letterSpacing: "-0.01em",
  },
  brandMark: { fontSize: 18, color: accent },
  nav: { display: "flex", gap: 4 },
  navBtn: {
    border: "none",
    background: "transparent",
    padding: "8px 14px",
    borderRadius: 7,
    fontSize: 13.5,
    fontWeight: 500,
    color: sub,
    cursor: "pointer",
  },
  navBtnActive: {
    border: "none",
    background: "#F0F1F4",
    padding: "8px 14px",
    borderRadius: 7,
    fontSize: 13.5,
    fontWeight: 500,
    color: ink,
    cursor: "pointer",
  },
  main: { padding: "40px 24px 80px" },
  container: { maxWidth: 920, margin: "0 auto" },
  pageHead: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  h1: { fontSize: 26, fontWeight: 650, margin: 0, letterSpacing: "-0.015em" },
  sub: { fontSize: 14, color: sub, margin: "6px 0 0" },

  card: {
    background: "#fff",
    border: `1px solid ${line}`,
    borderRadius: 12,
    padding: 24,
    marginBottom: 20,
  },
  fieldLabel: { fontSize: 14, fontWeight: 600 },
  fieldHint: { fontSize: 12.5, color: sub, marginTop: 2, marginBottom: 16 },

  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    border: `1px solid ${line}`,
    borderRadius: 8,
    padding: "10px 12px",
    marginBottom: 16,
    cursor: "pointer",
  },
  chooseBtn: {
    fontSize: 13,
    fontWeight: 600,
    background: "#F0F1F4",
    padding: "6px 12px",
    borderRadius: 6,
  },
  fileName: { fontSize: 13.5, color: sub },

  primaryBtn: {
    background: accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
  primaryBtnInline: {
    background: accent,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  primaryBtnDisabled: {
    background: "#D7DAE0",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "not-allowed",
    whiteSpace: "nowrap",
  },

  errorBox: {
    background: "#FDECEC",
    border: "1px solid #F3B9B9",
    color: "#8A1F1F",
    borderRadius: 8,
    padding: "12px 16px",
    fontSize: 13.5,
    marginBottom: 20,
  },

  statRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 28,
    marginBottom: 22,
    paddingBottom: 20,
    borderBottom: `1px solid ${line}`,
  },
  stat: { minWidth: 90 },
  statLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: sub,
    marginBottom: 4,
  },
  statValue: { fontSize: 15, fontWeight: 600 },

  badgeDone: {
    background: goodBg,
    color: good,
    fontSize: 11.5,
    fontWeight: 600,
    padding: "3px 9px",
    borderRadius: 99,
  },
  badgeRunning: {
    background: warnBg,
    color: warnText,
    fontSize: 11.5,
    fontWeight: 600,
    padding: "3px 9px",
    borderRadius: 99,
  },

  stepGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  stepCard: {
    border: `1px solid ${line}`,
    borderRadius: 10,
    padding: 16,
    background: "#FCFCFB",
  },
  stepCardHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  stepCardLabel: { fontSize: 13.5, fontWeight: 600 },
  stepCardTime: {
    fontSize: 20,
    fontWeight: 650,
    fontVariantNumeric: "tabular-nums",
  },
  stepCardDesc: { fontSize: 12.5, color: sub, marginTop: 4 },
  spinnerRow: { display: "flex", alignItems: "center", gap: 8 },
  spinner: {
    width: 13,
    height: 13,
    border: `2px solid ${line}`,
    borderTopColor: accent,
    borderRadius: "50%",
    display: "inline-block",
    animation: "spin 0.8s linear infinite",
  },

  linkBtn: {
    marginTop: 18,
    background: "none",
    border: "none",
    color: accent,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
  },
  linkBtnSmall: {
    background: "none",
    border: "none",
    color: accent,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
  },
  dangerLink: {
    background: "none",
    border: "none",
    color: "#B42318",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  backBtn: {
    background: "none",
    border: "none",
    color: sub,
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 18,
    padding: 0,
  },

  emptyState: {
    border: `1px dashed ${line}`,
    borderRadius: 10,
    padding: "48px 20px",
    textAlign: "center",
    color: sub,
    fontSize: 14,
  },

  tableWrap: {
    background: "#fff",
    border: `1px solid ${line}`,
    borderRadius: 12,
    overflow: "hidden",
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "11px 14px",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: sub,
    borderBottom: `1px solid ${line}`,
    background: "#FAFAF9",
  },
  tr: { borderBottom: `1px solid ${line}` },
  td: { padding: "12px 14px", fontWeight: 500 },
  tdCenter: { padding: "12px 14px", textAlign: "center" },
  tdMuted: { padding: "12px 14px", color: sub, fontSize: 12.5 },

  chunkList: { display: "flex", flexDirection: "column", gap: 12 },
  chunkCard: {
    background: "#fff",
    border: `1px solid ${line}`,
    borderRadius: 10,
    padding: 16,
  },
  chunkHead: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  chunkIndex: { fontSize: 12.5, fontWeight: 700, color: accent },
  chunkWords: { fontSize: 12, color: sub },
  chunkText: {
    fontSize: 13.5,
    lineHeight: 1.6,
    color: "#2A2E36",
    margin: 0,
    whiteSpace: "pre-wrap",
  },

  // Search view specific
  searchRow: { display: "flex", gap: 10 },
  searchInput: {
    flex: 1,
    border: `1px solid ${line}`,
    borderRadius: 8,
    padding: "11px 14px",
    fontSize: 14,
    outline: "none",
  },
  topKSelect: {
    border: `1px solid ${line}`,
    borderRadius: 8,
    padding: "0 10px",
    fontSize: 13.5,
    fontWeight: 500,
    background: "#fff",
  },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 },
  chip: {
    border: `1px solid ${line}`,
    background: "#FAFAF9",
    borderRadius: 99,
    padding: "6px 12px",
    fontSize: 12.5,
    color: sub,
    cursor: "pointer",
  },

  timingStrip: { display: "flex", gap: 10, marginBottom: 18 },
  timingPill: {
    background: "#fff",
    border: `1px solid ${line}`,
    borderRadius: 9,
    padding: "10px 14px",
    flex: 1,
    textAlign: "center",
  },
  timingPillValue: {
    display: "block",
    fontSize: 16,
    fontWeight: 650,
    fontVariantNumeric: "tabular-nums",
  },
  timingPillLabel: { display: "block", fontSize: 11, color: sub, marginTop: 2 },

  resultCard: {
    background: "#fff",
    border: `1px solid ${line}`,
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  resultHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  resultRank: { fontSize: 12, fontWeight: 700, color: sub, width: 22 },
  scoreBarTrack: {
    flex: 1,
    height: 6,
    background: "#F0F1F4",
    borderRadius: 99,
    overflow: "hidden",
  },
  scoreBarFill: { height: "100%", borderRadius: 99 },
  scoreLabel: {
    fontSize: 12.5,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    width: 56,
    textAlign: "right",
  },
  resultMeta: {
    display: "flex",
    gap: 6,
    fontSize: 11.5,
    color: sub,
    marginTop: 10,
  },
};
