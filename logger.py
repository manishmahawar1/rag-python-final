"""
logger.py
─────────────────────────────────────
Kaam: Har step ka time measure karna aur
      clean, readable logs print karna.
─────────────────────────────────────
"""

import time


class StepTimer:
    """
    Context manager jo ek step ka time measure karta hai.

    Use:
        with StepTimer("STEP 1: Extracting text"):
            ... code ...
    """

    def __init__(self, label):
        self.label = label
        self.start = None
        self.elapsed_ms = 0

    def __enter__(self):
        self.start = time.time()
        print(f"\n▶️  {self.label}...")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.elapsed_ms = (time.time() - self.start) * 1000
        if exc_type is None:
            print(f"✅ {self.label} done — {self.elapsed_ms:.2f}ms")
        else:
            print(f"❌ {self.label} FAILED — {self.elapsed_ms:.2f}ms")
        return False  # exception ko re-raise hone do


def print_header(title):
    print("\n" + "=" * 60)
    print(f"🚀 {title}")
    print("=" * 60)


def print_footer(title, total_ms):
    print("\n" + "=" * 60)
    print(f"🎉 {title}")
    print(f"   Total time: {total_ms:.2f}ms ({total_ms/1000:.2f}s)")
    print("=" * 60 + "\n")
