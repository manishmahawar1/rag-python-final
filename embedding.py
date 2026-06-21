"""
embedding.py
─────────────────────────────────────
KHUD KA EMBEDDING ALGORITHM
(Koi third-party AI library nahi — sirf math!)

Yeh file teen cheezein karti hai:
1. Tokenization        — text ko clean words mein todna
2. TF-IDF Vectorization — words ko numbers (vector) mein badalna
3. Cosine Similarity    — do vectors kitne "similar" hain, yeh nikalna

Concept (tumhari notebook se):
    Bag of Words  →  TF-IDF  →  Cosine Similarity
─────────────────────────────────────
"""

import re
import math
import numpy as np

# Fixed vector size — yeh db.py ke VECTOR_SIZE se match hona chahiye
VECTOR_SIZE = 300

STOP_WORDS = {
    "the", "is", "a", "an", "and", "or", "but", "in", "on", "at",
    "to", "for", "of", "with", "by", "from", "as", "this", "that",
    "be", "are", "was", "were", "shall", "will", "may", "can", "all",
    "it", "its", "their", "they", "them", "such", "any", "not"
}


# ─────────────────────────────────────
# STEP A: Tokenization
# "Employee gets 10 sick leaves" → ["employee", "gets", "sick", "leaves"]
# ─────────────────────────────────────
def tokenize(text: str) -> list:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)  # punctuation hatao
    words = text.split()
    return [w for w in words if len(w) > 2 and w not in STOP_WORDS]


# ─────────────────────────────────────
# STEP B: Vocabulary Builder (Bag of Words ka pehla kadam)
# Saare chunks ke unique words ko ek "dictionary" mein daalna,
# har word ko ek FIXED position (index) dena.
# ─────────────────────────────────────
def build_vocabulary(all_chunks: list, max_size: int = VECTOR_SIZE):
    """
    Returns:
        word_to_idx : { "employee": 0, "leave": 1, ... }
        doc_freq    : { "employee": 3, "leave": 5, ... }  (kitne chunks mein word hai)
    """
    doc_freq = {}
    all_tokens_list = []

    for chunk in all_chunks:
        tokens = tokenize(chunk)
        all_tokens_list.append(tokens)
        for word in set(tokens):  # set() = duplicate words ek hi baar count ho
            doc_freq[word] = doc_freq.get(word, 0) + 1

    # Sabse common words ko priority do (top max_size words rakho)
    sorted_words = sorted(doc_freq.items(), key=lambda x: x[1], reverse=True)
    top_words = [w for w, _ in sorted_words[:max_size]]

    word_to_idx = {word: idx for idx, word in enumerate(top_words)}

    return word_to_idx, doc_freq, all_tokens_list


# ─────────────────────────────────────
# STEP C: TF-IDF Vector banana ek chunk ke liye
#
# TF  (Term Frequency)        = (word is chunk mein kitni baar aaya) / (total words)
# IDF (Inverse Doc Frequency) = log( (total_docs+1) / (word ke saath docs+1) ) + 1
# TF-IDF = TF × IDF
# ─────────────────────────────────────
def compute_tfidf_vector(tokens: list, word_to_idx: dict, doc_freq: dict, total_docs: int) -> np.ndarray:
    vector = np.zeros(VECTOR_SIZE, dtype=np.float32)

    if not tokens:
        return vector

    total_words = len(tokens)

    # Har word kitni baar aaya, count karo
    word_counts = {}
    for w in tokens:
        word_counts[w] = word_counts.get(w, 0) + 1

    for word, count in word_counts.items():
        if word in word_to_idx:
            tf = count / total_words
            idf = math.log((total_docs + 1) / (doc_freq.get(word, 0) + 1)) + 1
            tfidf = tf * idf
            vector[word_to_idx[word]] = tfidf

    # Normalize karo (unit vector — magnitude = 1)
    # Yeh Cosine Similarity ke liye zaroori hai
    norm = np.linalg.norm(vector)
    if norm > 0:
        vector = vector / norm

    return vector


# ─────────────────────────────────────
# STEP D: Saare chunks ko ek saath embed karna
# (Yeh function ingestion.py se call hoga)
# ─────────────────────────────────────
def embed_chunks(chunks: list):
    if not chunks:
        raise ValueError("No chunks to embed — document mein readable text nahi mila ya bahut chhota hai")

    """
    Input:  ["chunk text 1", "chunk text 2", ...]
    Output: (vectors_list, word_to_idx)
    """
    word_to_idx, doc_freq, all_tokens_list = build_vocabulary(chunks)
    total_docs = len(chunks)

    vectors = []
    for tokens in all_tokens_list:
        vec = compute_tfidf_vector(tokens, word_to_idx, doc_freq, total_docs)
        vectors.append(vec)

    return vectors, word_to_idx, doc_freq


# ─────────────────────────────────────
# STEP E: Cosine Similarity
# Do vectors kitne "similar" hain — formula:
#
#   cosine(A, B) = (A · B) / (|A| × |B|)
#
# Result: -1 se 1 ke beech
#   1  = bilkul similar (same direction)
#   0  = unrelated
#  -1  = opposite
# ─────────────────────────────────────
def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    dot_product = np.dot(vec_a, vec_b)
    norm_a = np.linalg.norm(vec_a)
    norm_b = np.linalg.norm(vec_b)

    if norm_a == 0 or norm_b == 0:
        return 0.0

    return float(dot_product / (norm_a * norm_b))


# ─────────────────────────────────────
# STEP F: Query ko vector mein convert karna (Retrieval ke liye)
# Yeh SAME vocabulary use karta hai jo ingestion ke waqt banayi thi!
# ─────────────────────────────────────
def embed_query(query_text: str, word_to_idx: dict, doc_freq: dict, total_docs: int) -> np.ndarray:
    tokens = tokenize(query_text)
    return compute_tfidf_vector(tokens, word_to_idx, doc_freq, total_docs)


# ─────────────────────────────────────
# STEP G: Database se vocabulary load karke
# query ko vector mein convert karna (Retrieval ke liye)
# ─────────────────────────────────────
def vectorize_query(query_text: str, word_to_idx: dict, doc_freq: dict, total_docs: int) -> np.ndarray:
    """
    Yeh function Retrieval ke time use hota hai.
    SAME vocabulary use karta hai jo Ingestion ke time bani thi
    (database se load karke), naya vocabulary NAHI banata.
    """
    tokens = tokenize(query_text)
    return compute_tfidf_vector(tokens, word_to_idx, doc_freq, total_docs)