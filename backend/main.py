import base64
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import init_db, cleanup_expired, ensure_session, save_message, get_conversation_history
from emotion_detector import detect_emotion
from voice_pipeline import process_voice_streaming, generate_response_groq

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await cleanup_expired()
    yield


app = FastAPI(title="Sunno", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


# ── REST endpoint for Groq fallback (used by edge frontend) ──
class ChatRequest(BaseModel):
    transcript: str
    conversation_history: list[dict] = []
    session_id: str = ""


class ChatResponse(BaseModel):
    response_text: str
    emotion: str = "neutral"


@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    """Groq-powered chat endpoint for devices without WebGPU."""
    response_text = await generate_response_groq(req.transcript, req.conversation_history)

    emotion = detect_emotion(req.transcript)

    # Optionally persist to DB
    if req.session_id:
        await ensure_session(req.session_id)
        await save_message(req.session_id, "user", req.transcript, emotion)
        await save_message(req.session_id, "assistant", response_text)

    return ChatResponse(response_text=response_text, emotion=emotion)


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    logger.info(f"WebSocket connected: {session_id}")
    await ensure_session(session_id)

    audio_buffer = bytearray()

    async def send_message(msg: dict):
        await websocket.send_json(msg)

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)

            if msg["type"] == "audio_chunk":
                chunk = base64.b64decode(msg["data"])
                audio_buffer.extend(chunk)

            elif msg["type"] == "end_turn":
                if not audio_buffer:
                    await websocket.send_json({"type": "done"})
                    continue

                audio_bytes = bytes(audio_buffer)
                audio_buffer.clear()

                await websocket.send_json({"type": "thinking"})

                conversation_history = await get_conversation_history(session_id)

                # Streaming pipeline — sends transcript, response_text,
                # and audio_chunks directly via send_message callback
                transcript, response_text = await process_voice_streaming(
                    audio_bytes, conversation_history, send_message,
                )

                if not transcript:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Couldn't catch that. Try again?",
                    })
                    await websocket.send_json({"type": "done"})
                    continue

                # Persist to DB
                emotion = detect_emotion(transcript)
                await save_message(session_id, "user", transcript, emotion)
                await save_message(session_id, "assistant", response_text)

                await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


# Serve frontend — only if directory exists (frontend is on Netlify in production)
frontend_path = Path(__file__).resolve().parent.parent / "frontend"
if frontend_path.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
