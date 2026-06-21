"""
retrieval.py
─────────────────────────────────────
RETRIEVAL PIPELINE

User Question → Query Vector → Database Search (Cosine Similarity)
→ Top 5 Similar Chunks
─────────────────────────────────────
"""

import time
import numpy as np

from db import get_connection
from embedding import vectorize_query, cosine_similarity
from logger import StepTimer


def load_vocabulary():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT word, word_index, doc_freq FROM vocabulary;")
    rows = cur.fetchall()
    cur.close()
    conn.close()

    word_to_idx = {row[0]: row[1] for row in rows}
    doc_freq = {row[0]: row[2] for row in rows}
    return word_to_idx, doc_freq


def load_all_chunks():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, text, embedding, source, chunk_index FROM documents;")
    rows = cur.fetchall()
    cur.close()
    conn.close()

    chunks = []
    for row in rows:
        emb_str = row[2].strip("[]")
        emb_vector = np.array([float(x) for x in emb_str.split(",")], dtype=np.float32)
        chunks.append({
            "id": row[0],
            "text": row[1],
            "embedding": emb_vector,
            "source": row[3],
            "chunk_index": row[4],
        })
    return chunks


def get_total_chunk_count():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM documents;")
    count = cur.fetchone()[0]
    cur.close()
    conn.close()
    return count


def search(query_text: str, top_k: int = 5, min_score: float = 0.05) -> dict:
    print(f"\n🔍 SEARCH QUERY: \"{query_text}\"")

    timings = {}

    t0 = time.time()
    word_to_idx, doc_freq = load_vocabulary()
    timings["load_vocab_ms"] = round((time.time() - t0) * 1000, 2)
    print(f"   📖 Vocabulary loaded: {len(word_to_idx)} words")

    if not word_to_idx:
        return {"query": query_text, "results": [], "message": "No documents ingested yet.", "timings_ms": timings}

    total_docs = get_total_chunk_count()

    t0 = time.time()
    query_vector = vectorize_query(query_text, word_to_idx, doc_freq, total_docs)
    timings["query_embedding_ms"] = round((time.time() - t0) * 1000, 2)

    non_zero = int(np.count_nonzero(query_vector))
    print(f"   🔢 Query vectorized ({non_zero} non-zero values)")

    if non_zero == 0:
        print(f"   ⚠️  Query has no overlap with indexed vocabulary")
        return {
            "query": query_text,
            "results": [],
            "message": "No relevant matches found. None of the words in your query appear in the indexed documents.",
            "timings_ms": timings,
        }

    t0 = time.time()
    all_chunks = load_all_chunks()
    timings["load_chunks_ms"] = round((time.time() - t0) * 1000, 2)
    print(f"   📦 Loaded {len(all_chunks)} chunks from database")

    t0 = time.time()
    scored = []
    for chunk in all_chunks:
        score = cosine_similarity(query_vector, chunk["embedding"])
        scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    timings["similarity_search_ms"] = round((time.time() - t0) * 1000, 2)

    filtered = [(s, c) for s, c in scored if s >= min_score]
    top_results = filtered[:top_k]

    if not top_results:
        print(f"   ⚠️  No chunks scored above threshold ({min_score})")
        return {
            "query": query_text,
            "results": [],
            "message": f"No relevant matches found above similarity threshold ({min_score}).",
            "timings_ms": timings,
        }

    print(f"   🏆 Top {len(top_results)} matches found (threshold: {min_score})")
    for score, chunk in top_results:
        print(f"      Score: {score:.4f} | {chunk['source']} | chunk #{chunk['chunk_index']}")

    results = [
        {
            "score": round(float(score), 4),
            "text": chunk["text"],
            "source": chunk["source"],
            "chunk_index": chunk["chunk_index"],
        }
        for score, chunk in top_results
    ]

    return {
        "query": query_text,
        "results": results,
        "timings_ms": timings,
    }
    