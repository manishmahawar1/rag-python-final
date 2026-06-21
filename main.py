"""
main.py
─────────────────────────────────────
FASTAPI SERVER

Yeh React (frontend) aur Ingestion Pipeline (backend logic)
ke beech "pul" (bridge) hai — bilkul jaise server.js tha Node mein.

Run karne ka command (terminal mein):
    uvicorn main:app --reload --port 8000
─────────────────────────────────────
"""

import os
import shutil
import time
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from db import setup_database, get_connection
from ingestion import ingest_document

app = FastAPI(title="RAG Ingestion Pipeline (Python)")

# ─────────────────────────────────────
# CORS — React (port 3000) ko backend (port 8000)
# se baat karne ki permission deta hai
# ─────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # development ke liye sab allow
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_FILE_SIZE_MB = 10  # tumne bola tha 5MB se badi PDF nahi


# ─────────────────────────────────────
# Server start hote hi database setup karo
# ─────────────────────────────────────
@app.on_event("startup")
def on_startup():
    setup_database()


# ─────────────────────────────────────
# ROUTE 1: PDF Upload + Ingestion
# ─────────────────────────────────────
@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    print(f"\n📨 Upload request received: {file.filename}")

    # Sirf PDF allow karo
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed!")

    # File ko temporarily save karo
    file_path = UPLOAD_DIR / file.filename

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Size check karo
    size_mb = file_path.stat().st_size / (1024 * 1024)
    print(f"   📏 File size: {size_mb:.2f} MB")

    if size_mb > MAX_FILE_SIZE_MB:
        os.remove(file_path)
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({size_mb:.2f}MB). Max allowed: {MAX_FILE_SIZE_MB}MB"
        )

    try:
        result = ingest_document(str(file_path), file.filename)
        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────
# ROUTE 2: Stored documents ki list
# ─────────────────────────────────────
@app.get("/documents")
def list_documents():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT source, COUNT(*) as total_chunks, MIN(uploaded_at) as uploaded_at
        FROM documents
        GROUP BY source
        ORDER BY uploaded_at DESC;
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()

    return [
        {"source": r[0], "total_chunks": r[1], "uploaded_at": str(r[2])}
        for r in rows
    ]

@app.get("/documents/{source_name}/chunks")
def get_document_chunks(source_name: str):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT chunk_index, text, 
               LENGTH(text) - LENGTH(REPLACE(text, ' ', '')) + 1 AS word_count
        FROM documents
        WHERE source = %s
        ORDER BY chunk_index;
    """, (source_name,))
    rows = cur.fetchall()
    cur.close()
    conn.close()

    return [
        {"chunk_index": r[0], "text": r[1], "word_count": r[2]}
        for r in rows
    ]    



from retrieval import search as search_documents
from pydantic import BaseModel

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5

@app.post("/search")
def search_route(req: SearchRequest):
    try:
        result = search_documents(req.query, req.top_k)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────
# ROUTE 3: Health check (simple test)
# ─────────────────────────────────────
@app.get("/")
def health_check():
    return {"status": "RAG Python backend is running ✅"}
