import aiosqlite
import json
import time
from pathlib import Path

from config import MAX_CONVERSATION_TURNS, SESSION_EXPIRY_HOURS

DB_PATH = Path(__file__).resolve().parent / "sunno.db"


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                emotion TEXT,
                created_at REAL NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(session_id)
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_session
            ON messages(session_id, created_at)
        """)
        await db.commit()


async def cleanup_expired():
    """Delete sessions older than SESSION_EXPIRY_HOURS."""
    cutoff = time.time() - (SESSION_EXPIRY_HOURS * 3600)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM messages WHERE session_id IN (SELECT session_id FROM sessions WHERE updated_at < ?)", (cutoff,))
        await db.execute("DELETE FROM sessions WHERE updated_at < ?", (cutoff,))
        await db.commit()


async def ensure_session(session_id: str):
    now = time.time()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO sessions (session_id, created_at, updated_at) VALUES (?, ?, ?)",
            (session_id, now, now),
        )
        await db.execute(
            "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
            (now, session_id),
        )
        await db.commit()


async def save_message(session_id: str, role: str, content: str, emotion: str = None):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO messages (session_id, role, content, emotion, created_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, role, content, emotion, time.time()),
        )
        await db.execute(
            "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
            (time.time(), session_id),
        )
        await db.commit()


async def get_conversation_history(session_id: str) -> list[dict]:
    """Get last N turns of conversation for LLM context."""
    limit = MAX_CONVERSATION_TURNS * 2
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
            (session_id, limit),
        )
        rows = await cursor.fetchall()

    # Reverse to chronological order
    return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]
