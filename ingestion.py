"""
ingestion.py
─────────────────────────────────────
MAIN INGESTION PIPELINE

PDF → Clean Text → Chunks → Embeddings (TF-IDF) → PostgreSQL

Har step ka time print hota hai console mein.
─────────────────────────────────────
"""

import time
import json
import pypdfium2 as pdfium
import psycopg2.extras

from db import get_connection, VECTOR_SIZE
from embedding import embed_chunks
from logger import StepTimer, print_header, print_footer


# ─────────────────────────────────────
# STEP 1: PDF se text nikalna + cleaning
# ─────────────────────────────────────
def extract_text_from_pdf(file_path: str) -> str:
    with StepTimer("STEP 1: Extracting text from PDF") as t:
        full_text_parts = []

        pdf = pdfium.PdfDocument(file_path)
        num_pages = len(pdf)

        for page in pdf:
            textpage = page.get_textpage()
            page_text = textpage.get_text_range()
            full_text_parts.append(page_text)
            textpage.close()
            page.close()

        pdf.close()

        full_text = "\n".join(full_text_parts)
        clean_text = " ".join(full_text.split())

        word_count = len(clean_text.split())
        print(f"   📄 Pages: {num_pages}")
        print(f"   📝 Words extracted: {word_count}")
        print(f"   🔍 Sample: \"{clean_text[:100]}...\"")

    return clean_text
# ─────────────────────────────────────
# STEP 2: Chunking (with overlap)
# ─────────────────────────────────────
def chunk_text(text: str, chunk_size: int = 250, overlap: int = 30) -> list:
    with StepTimer("STEP 2: Creating chunks") as t:
        words = text.split()
        chunks = []

        # Agar poora document hi chhota hai (jaise test PDF),
        # toh minimum chunk length bhi chhota rakho
        min_chunk_words = 5 if len(words) < 100 else 50

        step = chunk_size - overlap
        for i in range(0, len(words), step):
            chunk = " ".join(words[i:i + chunk_size])
            if len(chunk.split()) >= min_chunk_words:
                chunks.append(chunk)

        print(f"   ✂️  Chunk size: {chunk_size} words, overlap: {overlap} words")
        print(f"   📦 Total chunks created: {len(chunks)}")
        if chunks:
            print(f"   🔍 Chunk 1 sample: \"{chunks[0][:80]}...\"")

    return chunks


# ─────────────────────────────────────
# STEP 3: Embeddings banana (Custom TF-IDF)
# ─────────────────────────────────────
def create_embeddings(chunks: list):
    with StepTimer("STEP 3: Creating TF-IDF embeddings (custom algorithm)") as t:
        print("   🧮 Algorithm: Bag of Words + TF-IDF (no external AI library)")

        vectors, word_to_idx, doc_freq = embed_chunks(chunks)

        non_zero_avg = sum(int((v != 0).sum()) for v in vectors) / len(vectors)
        print(f"   📐 Vocabulary size: {len(word_to_idx)} words")
        print(f"   📐 Vector size per chunk: {VECTOR_SIZE} numbers")
        print(f"   📊 Avg non-zero values per vector: {non_zero_avg:.1f}")

    return vectors, word_to_idx, doc_freq


# ─────────────────────────────────────
# STEP 4: PostgreSQL mein store karna
# ─────────────────────────────────────
def store_in_postgres(chunks: list, vectors: list, word_to_idx: dict,
                       doc_freq: dict, file_name: str):
    with StepTimer("STEP 4: Storing in PostgreSQL") as t:
        conn = get_connection()
        cur = conn.cursor()

        # Saare purane chunks isi file ke hatao (re-upload case)
        cur.execute("DELETE FROM documents WHERE source = %s;", (file_name,))

        # Chunks + vectors insert karo (BULK INSERT — bahut fast!)
        # execute_values ek hi network round-trip mein saari rows bhejta hai,
        # executemany() har row ke liye ALAG request bhejta hai (slow hota hai
        # khaaskar cloud DB jaise Neon ke saath, jahan network latency hai)
        rows = []
        for i, (chunk, vec) in enumerate(zip(chunks, vectors)):
            vec_str = "[" + ",".join(f"{x:.6f}" for x in vec.tolist()) + "]"
            rows.append((chunk, vec_str, file_name, i))

        insert_query = """
            INSERT INTO documents (text, embedding, source, chunk_index)
            VALUES %s
        """
        psycopg2.extras.execute_values(
            cur,
            insert_query,
            rows,
            template="(%s, %s::vector, %s, %s)",
            page_size=500
        )

        # Vocabulary bhi save karo (Retrieval pipeline ke liye zaroori!)
        cur.execute("DELETE FROM vocabulary;")
        vocab_rows = [
            (word, idx, doc_freq.get(word, 1))
            for word, idx in word_to_idx.items()
        ]
        cur.executemany(
            "INSERT INTO vocabulary (word, word_index, doc_freq) VALUES (%s, %s, %s) "
            "ON CONFLICT (word) DO UPDATE SET word_index = EXCLUDED.word_index, "
            "doc_freq = EXCLUDED.doc_freq;",
            vocab_rows
        )

        conn.commit()
        cur.close()
        conn.close()

        print(f"   💾 Stored {len(rows)} chunks in 'documents' table")
        print(f"   📖 Saved {len(vocab_rows)} vocabulary words")

    return len(rows)
# ─────────────────────────────────────
# MAIN PIPELINE — sab steps ko jodta hai
# ─────────────────────────────────────
def ingest_document(file_path: str, file_name: str) -> dict:
    print_header(f"STARTING INGESTION: {file_name}")
    pipeline_start = time.time()

    timings = {}

    try:
        t0 = time.time()
        text = extract_text_from_pdf(file_path)
        timings["extract_text_ms"] = round((time.time() - t0) * 1000, 2)

        t0 = time.time()
        chunks = chunk_text(text)
        timings["chunking_ms"] = round((time.time() - t0) * 1000, 2)

        t0 = time.time()
        vectors, word_to_idx, doc_freq = create_embeddings(chunks)
        timings["embedding_ms"] = round((time.time() - t0) * 1000, 2)

        t0 = time.time()
        chunk_count = store_in_postgres(chunks, vectors, word_to_idx, doc_freq, file_name)
        timings["storage_ms"] = round((time.time() - t0) * 1000, 2)

        total_ms = (time.time() - pipeline_start) * 1000
        print_footer(f"INGESTION COMPLETE: {file_name}", total_ms)

        # Step-by-step timing summary
        print("⏱️  STEP TIMING BREAKDOWN:")
        for step, ms in timings.items():
            print(f"   {step:.<30} {ms:>8.2f}ms")
        print()

        return {
            "success": True,
            "file_name": file_name,
            "chunks": chunk_count,
            "vocabulary_size": len(word_to_idx),
            "total_time_ms": round(total_ms, 2),
            "step_timings_ms": timings,
        }

    except Exception as e:
        total_ms = (time.time() - pipeline_start) * 1000
        print(f"\n❌ INGESTION FAILED after {total_ms:.2f}ms")
        print(f"   Error: {str(e)}")
        raise
