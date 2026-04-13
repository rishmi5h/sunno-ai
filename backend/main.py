import base64
import hashlib
import hmac
import json
import logging
import re
import time as _time
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite
import razorpay
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import (
    init_db, cleanup_expired, ensure_session, save_message,
    get_conversation_history, save_subscription, get_active_subscription, is_premium,
)
from emotion_detector import detect_emotion
from voice_pipeline import process_voice_streaming, process_voice_onnx, generate_response_groq
from config import (
    ONNX_ENABLED, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
    PREMIUM_PRICE_PAISE, PREMIUM_DURATION_DAYS,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await cleanup_expired()
    # Lazy-load ONNX models in background if enabled
    if ONNX_ENABLED:
        import asyncio
        task = asyncio.create_task(_load_onnx_models())
        task.add_done_callback(
            lambda t: logger.error(f"ONNX load failed: {t.exception()}")
            if t.exception() else None
        )
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
    allow_credentials=False,
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


class RecapRequest(BaseModel):
    conversation_history: list[dict] = []


class RecapResponse(BaseModel):
    summary: str
    mood: str = "neutral"
    message_count: int = 0


@app.post("/api/recap", response_model=RecapResponse)
async def recap_endpoint(req: RecapRequest):
    """Generate a one-line session recap from conversation history."""
    if not req.conversation_history:
        return RecapResponse(summary="", message_count=0)

    from voice_pipeline import generate_recap
    summary, mood = await generate_recap(req.conversation_history)
    user_msgs = sum(1 for m in req.conversation_history if m.get("role") == "user")
    return RecapResponse(summary=summary, mood=mood, message_count=user_msgs)


class WaitlistRequest(BaseModel):
    email: str


@app.post("/api/waitlist")
async def waitlist_endpoint(req: WaitlistRequest):
    """Collect waitlist emails for premium tier."""
    import re
    email = req.email.strip().lower()
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return {"status": "error", "message": "Invalid email"}

    # Save to SQLite
    import aiosqlite
    import time as _time
    db_path = Path(__file__).resolve().parent / "sunno.db"
    async with aiosqlite.connect(str(db_path)) as db:
        await db.execute(
            "CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, created_at REAL)"
        )
        await db.execute(
            "INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)",
            (email, _time.time()),
        )
        await db.commit()

    logger.info(f"Waitlist signup: {email}")
    return {"status": "ok"}


# ── Razorpay Payment ──

_razorpay_client = None
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def get_razorpay():
    global _razorpay_client
    if _razorpay_client is None:
        _razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    return _razorpay_client


class CreateOrderRequest(BaseModel):
    email: str


@app.post("/api/create-order")
async def create_order(req: CreateOrderRequest):
    email = req.email.strip().lower()
    if not _EMAIL_RE.match(email):
        return JSONResponse(status_code=400, content={"message": "Invalid email"})
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        return JSONResponse(status_code=503, content={"message": "Payment not configured"})

    try:
        order = get_razorpay().order.create({
            "amount": PREMIUM_PRICE_PAISE,
            "currency": "INR",
            "receipt": f"sunno_{int(_time.time())}",
            "notes": {"email": email},
        })
        return {
            "order_id": order["id"],
            "amount": PREMIUM_PRICE_PAISE,
            "currency": "INR",
            "key_id": RAZORPAY_KEY_ID,
        }
    except Exception as e:
        logger.error(f"Razorpay order creation failed: {e}")
        return JSONResponse(status_code=500, content={"message": "Order creation failed"})


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    email: str


@app.post("/api/verify-payment")
async def verify_payment(req: VerifyPaymentRequest):
    email = req.email.strip().lower()
    if not RAZORPAY_KEY_SECRET:
        return JSONResponse(status_code=503, content={"message": "Payment not configured"})

    # Verify HMAC-SHA256 signature
    message = f"{req.razorpay_order_id}|{req.razorpay_payment_id}"
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(), message.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, req.razorpay_signature):
        logger.warning(f"Payment verification failed for {email}")
        return JSONResponse(status_code=400, content={"status": "error", "message": "Verification failed"})

    expires_at = await save_subscription(
        email, req.razorpay_order_id, req.razorpay_payment_id,
        PREMIUM_PRICE_PAISE, PREMIUM_DURATION_DAYS,
    )
    logger.info(f"Premium subscription: {email} until {expires_at}")
    return {"status": "ok", "premium": True, "expires_at": expires_at}


@app.get("/api/check-subscription")
async def check_subscription(email: str = ""):
    email = email.strip().lower()
    if not email or not _EMAIL_RE.match(email):
        return {"premium": False}
    sub = await get_active_subscription(email)
    if sub:
        return {"premium": True, "expires_at": sub["expires_at"]}
    return {"premium": False}


class TTSRequest(BaseModel):
    text: str
    email: str
    mood: str = "default"


@app.post("/api/tts")
async def tts_endpoint(req: TTSRequest):
    """Premium ElevenLabs TTS — requires active subscription."""
    email = req.email.strip().lower()
    if not await is_premium(email):
        return JSONResponse(status_code=403, content={"error": "Premium subscription required"})

    from voice_pipeline import synthesize_speech_streaming
    try:
        audio_stream = synthesize_speech_streaming(req.text)
        return StreamingResponse(audio_stream, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"Premium TTS failed: {e}")
        return JSONResponse(status_code=500, content={"error": "TTS generation failed"})


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


import re
_VALID_SESSION_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10MB (~5 minutes of 16kHz float32)
MAX_AUDIO_B64 = MAX_AUDIO_BYTES * 4 // 3  # base64 overhead


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    # Validate session ID
    if not _VALID_SESSION_ID.match(session_id):
        await websocket.close(code=1008, reason="Invalid session ID")
        return

    await websocket.accept()
    logger.info(f"WebSocket connected: {session_id}")
    await ensure_session(session_id)

    audio_buffer = bytearray()
    mode = "cloud"
    processing = False  # prevent concurrent processing

    async def send_message(msg: dict):
        await websocket.send_json(msg)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            if "type" not in msg:
                await websocket.send_json({"type": "error", "message": "Missing message type"})
                continue

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
                if processing:
                    await websocket.send_json({"type": "error", "message": "Still processing"})
                    continue

                data = msg.get("data", "")
                if len(data) > MAX_AUDIO_B64:
                    await websocket.send_json({"type": "error", "message": "Audio too large"})
                    continue

                import numpy as np
                from audio_utils import pcm_base64_to_numpy

                audio_pcm = pcm_base64_to_numpy(data)
                if len(audio_pcm) < 1600:  # less than 100ms
                    await websocket.send_json({"type": "done"})
                    continue

                processing = True
                try:
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
                finally:
                    processing = False
                continue

            # ── Cloud mode: existing audio_chunk + end_turn protocol ──
            if msg["type"] == "audio_chunk":
                chunk = base64.b64decode(msg.get("data", ""))
                if len(audio_buffer) + len(chunk) > MAX_AUDIO_BYTES:
                    await websocket.send_json({"type": "error", "message": "Audio buffer exceeded"})
                    audio_buffer.clear()
                    continue
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
        logger.error(f"WebSocket error for {session_id}: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": "Internal server error"})
        except Exception as send_err:
            logger.warning(f"Failed to send error to {session_id}: {send_err}")


# Use absolute path resolution (CWD-independent for uvicorn --app-dir)
# __file__ may be relative when loaded via uvicorn --app-dir, so use Path(__file__).absolute()
_BACKEND_DIR = Path(__file__).absolute().parent
_PROJECT_ROOT = _BACKEND_DIR.parent

# Serve only VAD model for browser-side use (not the full models directory)
from fastapi.responses import FileResponse

@app.get("/models/silero_vad.onnx")
async def serve_vad_model():
    vad_path = _PROJECT_ROOT / "models" / "silero_vad.onnx"
    if vad_path.exists():
        return FileResponse(str(vad_path), media_type="application/octet-stream")
    return {"error": "VAD model not found"}

# Serve frontend — only if directory exists (frontend is on Netlify in production)
frontend_path = _PROJECT_ROOT / "frontend"
logger.info(f"Frontend path: {frontend_path} (exists: {frontend_path.is_dir()})")
if frontend_path.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
