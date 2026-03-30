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
from voice_pipeline import process_voice_streaming, process_voice_onnx, generate_response_groq
from config import ONNX_ENABLED

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await cleanup_expired()
    # Lazy-load ONNX models in background if enabled
    if ONNX_ENABLED:
        import asyncio
        asyncio.create_task(_load_onnx_models())
    yield


async def _load_onnx_models():
    """Load ONNX models in background thread to avoid blocking startup."""
    import asyncio
    from models.model_manager import get_pipeline
    await asyncio.to_thread(get_pipeline)


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
    from models.model_manager import is_available
    return {"status": "ok", "onnx": is_available()}


# ── REST endpoint for Groq fallback (used by edge frontend) ──
class ChatRequest(BaseModel):
    transcript: str
    conversation_history: list[dict] = []
    session_id: str = ""
    mood: str = "default"
    language: str = "auto"


class ChatResponse(BaseModel):
    response_text: str
    emotion: str = "neutral"


@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    """Groq-powered chat endpoint for devices without WebGPU."""
    response_text = await generate_response_groq(req.transcript, req.conversation_history, req.mood, req.language)

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
    mode = "cloud"  # default; client can switch via init message

    async def send_message(msg: dict):
        await websocket.send_json(msg)

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)

            # Mode negotiation
            if msg["type"] == "init":
                requested = msg.get("mode", "cloud")
                if requested == "onnx" and ONNX_ENABLED:
                    from models.model_manager import is_available
                    if is_available():
                        mode = "onnx"
                    else:
                        mode = "cloud"
                else:
                    mode = "cloud"
                await websocket.send_json({"type": "init_ack", "mode": mode})
                logger.info(f"Session {session_id}: mode={mode}")
                continue

            # ── ONNX mode: single audio_data message per utterance ──
            if msg["type"] == "audio_data" and mode == "onnx":
                import numpy as np
                from audio_utils import pcm_base64_to_numpy

                audio_pcm = pcm_base64_to_numpy(msg["data"])
                if len(audio_pcm) < 1600:  # less than 100ms
                    await websocket.send_json({"type": "done"})
                    continue

                conversation_history = await get_conversation_history(session_id)

                transcript, response_text = await process_voice_onnx(
                    audio_pcm, conversation_history, send_message,
                    mood=msg.get("mood", "default"),
                    language=msg.get("language", "auto"),
                )

                if transcript:
                    emotion = detect_emotion(transcript)
                    await save_message(session_id, "user", transcript, emotion)
                    await save_message(session_id, "assistant", response_text)
                continue

            # ── Cloud mode: existing audio_chunk + end_turn protocol ──
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
