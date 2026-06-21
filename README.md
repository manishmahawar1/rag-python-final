# RAG System — Ingestion + Retrieval Pipeline 🐍

**Stack:** React + FastAPI (Python) + PostgreSQL (pgvector) + Custom TF-IDF Embeddings
**Author:** Manish
**Status:** Ingestion ✅ Complete | Retrieval ✅ Complete | LLM/Chatbot ⏳ Next

---

## Project Kya Hai?

Yeh ek **RAG (Retrieval Augmented Generation)** system hai jo PDF documents ko process karke PostgreSQL mein store karta hai, aur fir natural language questions se un documents mein **semantic search** karta hai.

**Sabse khaas baat:** Embedding banane ke liye koi pre-trained AI model (OpenAI, Gemini, Xenova/Transformers) use nahi kiya gaya. Iski jagah **khud ka TF-IDF + Cosine Similarity algorithm** Python mein likha gaya hai — pure math se, koi third-party AI library nahi.

```
PDF Upload → Text Extract → Chunks → TF-IDF Embeddings → PostgreSQL
                                                                ↓
User Question → Query Vector → Cosine Similarity Search → Top-K Relevant Chunks
```

---

## Tech Stack

| Layer | Technology | Kaam |
|---|---|---|
| Frontend | React | Upload UI, Search UI, History |
| Backend | Python (FastAPI) | API server |
| Database | PostgreSQL + pgvector | Vector storage |
| PDF Reading | pypdfium2 | Fast text extraction |
| Embedding | Custom TF-IDF (NumPy) | Text → Vector |
| Similarity | Custom Cosine Similarity | Vector comparison |
| Local DB option | Docker (pgvector image) | Faster than cloud for testing |

---

## Project Structure

```
rag-python-final/
├── main.py            ← FastAPI server (routes: /upload, /search, /documents)
├── ingestion.py         ← Ingestion pipeline (Extract → Chunk → Embed → Store)
├── retrieval.py           ← Retrieval pipeline (Query → Vector → Search → Top-K)
├── embedding.py             ← Custom TF-IDF + Cosine Similarity algorithm
├── db.py                      ← PostgreSQL connection + table setup
├── logger.py                    ← Step-by-step timing utility (StepTimer)
├── requirements.txt               ← Python dependencies
├── .env                              ← DATABASE_URL, PORT (not committed to Git)
├── .gitignore
└── uploads/                            ← Temporary PDF storage

frontend/
└── src/
    └── App.jsx          ← Upload, Search, History, Chunk-viewer UI
```

---

## How It Works — Two Pipelines

### 1. Ingestion Pipeline (One-time, per document)

```
STEP 1: Extract Text       — pypdfium2 reads the PDF, page by page
STEP 2: Chunk Text         — splits into 250-word chunks, 30-word overlap
STEP 3: Generate Embeddings — custom TF-IDF turns each chunk into a 300-number vector
STEP 4: Store in PostgreSQL — chunks + vectors + vocabulary saved
```

Two tables get populated:
- **`documents`** — every chunk's text, its embedding vector, source file, chunk index
- **`vocabulary`** — the 300 words chosen for the vector space, with their document frequency (needed later for query vectorization)

### 2. Retrieval Pipeline (Every search query)

```
STEP A: Load vocabulary       — from the `vocabulary` table (same words used during ingestion)
STEP B: Vectorize the query    — tokenize + TF-IDF, using the SAME vocabulary
STEP C: Load all chunks         — every stored embedding from `documents`
STEP D: Cosine similarity        — compare query vector against every chunk vector
STEP E: Rank + filter             — sort by score, drop anything below a similarity threshold
STEP F: Return top-K               — best matching chunks, with scores
```

**Why the same vocabulary matters:** the query has to be converted into a vector using the exact same word→index mapping that was used when the documents were ingested. If they didn't match, similarity comparisons would be meaningless.

---

## 🚀 Fresh Setup Instructions

You'll need this on **any new machine** — whether it's your office Ubuntu PC or another Windows laptop, since `venv/`, `.env`, and `node_modules/` are not pushed to GitHub.

---

### Common Prerequisites (Both OS)

- Python 3.10+
- Node.js + npm (for the React frontend)
- A PostgreSQL database — either:
  - **Docker** (recommended — fast, no manual pgvector install), or
  - **Neon.tech** (free cloud Postgres with pgvector built in)
- Git

---

## 🪟 Windows Setup

### Step 1 — Clone or download the project
```bash
git clone <your-repo-url>
cd rag-python-final
```

### Step 2 — Create virtual environment
```bash
python -m venv venv
```

**Activate it:**
```bash
# Git Bash:
source venv/Scripts/activate

# CMD / PowerShell:
venv\Scripts\activate
```

### Step 3 — Install dependencies
```bash
pip install -r requirements.txt
```

### Step 4 — Set up PostgreSQL (pick ONE option)

**Option A — Docker (recommended, fast):**
```bash
docker run --name rag-postgres -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=ragdb -p 5432:5432 -d ankane/pgvector
```

**Option B — Neon.tech (cloud, no local install needed):**
Just create a free project at neon.tech and copy the connection string.

### Step 5 — Create `.env` file
In the project root:
```env
DATABASE_URL=postgresql://postgres:yourpassword@127.0.0.1:5432/ragdb
PORT=8000
```
> ⚠️ On Windows, use `127.0.0.1` instead of `localhost` — `localhost` can resolve to IPv6 (`::1`) and fail to connect to Docker's exposed port.

### Step 6 — Run the backend
```bash
uvicorn main:app --port 8000
```
> ⚠️ Avoid `--reload` when testing large PDF uploads — the file-watcher process competes for CPU with PDF extraction and can roughly **3x slow down** ingestion time. Use `--reload` only while actively editing code.

### Step 7 — Run the frontend
```bash
cd frontend
npm install
npm start
```

---

## 🐧 Ubuntu Setup (Office PC)

### Step 1 — Install Python tools
```bash
sudo apt update
sudo apt install python3-pip python3-venv libpq-dev -y
```
> `libpq-dev` is required — without it, `psycopg2-binary` will fail to build with a `pg_config executable not found` error.

### Step 2 — Clone the project
```bash
git clone <your-repo-url>
cd rag-python-final
```
Or if you downloaded a ZIP from GitHub, extract it and `cd` into the folder.

### Step 3 — Create virtual environment
```bash
python3 -m venv venv
source venv/bin/activate
```

### Step 4 — Install dependencies
```bash
pip install -r requirements.txt
```

### Step 5 — Set up PostgreSQL

**Option A — Docker:**
```bash
docker run --name rag-postgres -e POSTGRES_PASSWORD=yourpassword -e POSTGRES_DB=ragdb -p 5432:5432 -d ankane/pgvector
```
(If Docker isn't installed: `sudo apt install docker.io -y`, then `sudo systemctl start docker`.)

**Option B — Neon.tech:** same as Windows — just use the cloud connection string.

### Step 6 — Create `.env`
```bash
printf "DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/ragdb\nPORT=8000\n" > .env
```
> On Linux, `localhost` resolves correctly (the IPv6 issue is Windows-specific), so this is safe here.

### Step 7 — Run the backend
```bash
uvicorn main:app --port 8000
```

### Step 8 — Run the frontend
```bash
cd frontend
npm install
npm start
```

---

## Verifying It Works

1. Open `http://localhost:8000` → should show `{"status": "RAG Python backend is running ✅"}`
2. Open `http://localhost:8000/docs` → Swagger UI for testing `/upload` and `/search` directly
3. Open `http://localhost:3000` (React) → use the Upload and Search tabs

### Quick test sequence
```
1. Upload tab → upload a PDF
2. Watch the 4 step-cards complete (Extract → Chunk → Embed → Store)
3. Search tab → ask a question related to the PDF's actual content
4. Results show ranked chunks with similarity scores
```

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| GET | `/` | Health check |
| POST | `/upload` | Upload a PDF and run the full ingestion pipeline |
| GET | `/documents` | List all ingested documents with chunk counts |
| GET | `/documents/{source_name}/chunks` | View all chunks for a specific file |
| POST | `/search` | Run a retrieval query — body: `{"query": "...", "top_k": 5}` |

---

## Embedding Algorithm — How It Works

```
1. Tokenization      — lowercase, strip punctuation, remove stop words
2. Vocabulary Build   — collect unique words across all chunks,
                         keep only the top 300 most frequent ones
3. TF-IDF Calculation  — for each word in the vocabulary:
                          TF  = (word count in chunk) / (total words in chunk)
                          IDF = log((total_chunks + 1) / (chunks_with_word + 1)) + 1
                          TF-IDF = TF × IDF
4. Normalization        — scale the vector so its magnitude = 1
                          (required for cosine similarity to work correctly)
5. Cosine Similarity      — cosine(A, B) = (A · B) / (|A| × |B|)
                          Used at search time to rank chunks against the query
```

**Why `VECTOR_SIZE = 300`:** a deliberate trade-off. A larger vocabulary captures more words but makes every vector bigger (slower similarity search, more storage). 300 was chosen as a reasonable middle ground for documents in the few-hundred-page range.

**Known limitation (by design, since no AI model is used):** this is exact-word matching. A query for "sick leave" will not match a chunk that only says "medical leave" — there's no semantic understanding of synonyms, the way a pre-trained embedding model (like BERT or MiniLM) would provide. This is the deliberate trade-off of building the algorithm from scratch instead of using a third-party AI library.

---

## Performance Notes (from real testing)

| Document | Pages | Words | Extract | Chunk | Embed | Store | Total |
|---|---|---|---|---|---|---|---|
| Small contract | 3 | 722 | ~46ms | ~1ms | ~2ms | ~1.2s (Neon cold start) | ~1.3s |
| Large synthetic test | 356 | 582,278 | ~1.5-4s | ~150ms | ~750ms | ~1.6s | ~4-7s |

Key learnings:
- Switching from `pdfplumber` → `pypdfium2` gave a **6-8x speedup** on text extraction (pdfium is the same engine Chrome uses).
- Running `uvicorn` **without** `--reload` avoided CPU contention from the file-watcher, roughly **3x faster** extraction on large files.
- Switching `psycopg2.executemany()` → `psycopg2.extras.execute_values()` for bulk inserts turned a multi-minute store step (2647 individual inserts) into ~1.6 seconds (one batched request).
- A local Docker Postgres avoids the "cold start" delay (~10-12s) that Neon's free tier has after periods of inactivity.

---

## Common Issues & Fixes

| Problem | Cause | Fix |
|---|---|---|
| `psql: command not found` | PostgreSQL `bin` not in PATH | Add `C:\Program Files\PostgreSQL\<version>\bin` to PATH (Windows) and restart terminal |
| `pg_config executable not found` (Ubuntu) | Missing PostgreSQL dev headers | `sudo apt install libpq-dev` |
| `relation "documents" does not exist` | Table was dropped (not just rows deleted) via pgAdmin | Restart the server — `db.py` auto-creates tables on startup |
| `fe_sendauth: no password supplied` | Malformed `.env` (missing newline, password not parsed) | Recreate `.env` with `printf "KEY=value\n"` to guarantee proper line endings |
| Connection fails on `localhost` but works on `127.0.0.1` (Windows only) | `localhost` resolves to IPv6 (`::1`), Docker exposes IPv4 | Use `127.0.0.1` in `DATABASE_URL` on Windows |
| Two PostgreSQL processes fighting over port 5432 | A Windows PostgreSQL installer service running alongside Docker | Disable the Windows PostgreSQL service via `services.msc`, keep only Docker's instance |
| All search results have `score: 0` | Query words don't appear anywhere in the indexed vocabulary | Expected behavior — confirms the algorithm only matches on real word overlap |
| Large PDF takes 10+ seconds to extract | Slow PDF library or `--reload` flag overhead | Use `pypdfium2`, run without `--reload` for performance testing |

---

## What's Next — Retrieval → Chatbot

The retrieval pipeline currently returns **raw matching chunks** with similarity scores. The next step is wiring these into a local LLM (Ollama) so that instead of showing raw text, the system generates a natural-language answer grounded in the retrieved context — turning this from a search engine into an actual chatbot.

```
Current:  Question → Top 5 chunks (raw text + score)
Next:     Question → Top 5 chunks → Ollama (local LLM) → Natural answer
```

---

*Built while learning RAG from first principles — June 2026*
