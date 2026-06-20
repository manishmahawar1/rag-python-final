"""
db.py
─────────────────────────────────────
Kaam: PostgreSQL (Neon.tech) se connect karna,
      pgvector extension enable karna,
      aur documents table banana.
─────────────────────────────────────
"""

import os
import time
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Hamare custom TF-IDF embedding ka fixed size
# (yeh VECTOR_SIZE embedding.py mein bhi same hona chahiye)
VECTOR_SIZE = 300


def get_connection():
    """Ek naya database connection banata hai."""
    return psycopg2.connect(DATABASE_URL)


def setup_database():
    """
    Database setup karta hai:
    1. pgvector extension enable karta hai
    2. documents table banata hai (agar exist nahi karti)
    3. Fast search ke liye index banata hai
    """
    print("\n🔧 Setting up database...")
    start = time.time()

    conn = get_connection()
    cur = conn.cursor()

    # Step 1: pgvector extension
    cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    print("   ✅ pgvector extension enabled")

    # Step 2: documents table
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS documents (
            id          SERIAL PRIMARY KEY,
            text        TEXT NOT NULL,
            embedding   vector({VECTOR_SIZE}),
            source      TEXT,
            chunk_index INTEGER,
            uploaded_at TIMESTAMP DEFAULT NOW()
        );
    """)
    print("   ✅ documents table ready")

    # Step 3: vocabulary table (TF-IDF ke liye vocabulary save karni padti hai,
    # taaki retrieval ke waqt query ko SAME vocabulary se vectorize kar sakein)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS vocabulary (
            id      SERIAL PRIMARY KEY,
            word    TEXT UNIQUE NOT NULL,
            word_index INTEGER NOT NULL,
            doc_freq INTEGER DEFAULT 1
        );
    """)
    print("   ✅ vocabulary table ready")

    # Step 4: vector index (fast similarity search ke liye)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS embedding_idx
        ON documents
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
    """)
    print("   ✅ vector index created")

    conn.commit()
    cur.close()
    conn.close()

    elapsed = (time.time() - start) * 1000
    print(f"🔧 Database setup complete ({elapsed:.2f}ms)\n")


def reset_database():
    """Table drop karke fresh banata hai (testing ke liye useful)."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS documents CASCADE;")
    cur.execute("DROP TABLE IF EXISTS vocabulary CASCADE;")
    conn.commit()
    cur.close()
    conn.close()
    print("🗑️  Tables dropped. Run setup_database() again to recreate.")


if __name__ == "__main__":
    # Yeh file directly chalane se database setup ho jayega
    setup_database()
