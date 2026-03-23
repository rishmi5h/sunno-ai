import asyncio
import base64
import json
import logging
import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config import MAX_CONVERSATION_TURNS
from voice_pipeline import process_voice

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Sunno")

# In-memory session store (SQLite in Phase 2)
sessions: dict[str, list[dict]] = {}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    logger.info(f"WebSocket connected: {session_id}")

    if session_id not in sessions:
        sessions[session_id] = []

    audio_buffer = bytearray()

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

                # Send thinking state
                await websocket.send_json({"type": "thinking"})

                # Process through voice pipeline
                conversation_history = sessions[session_id]
                transcript, response_text, audio = await process_voice(
                    audio_bytes, conversation_history,
                )

                if not transcript:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Couldn't catch that. Try again?",
                    })
                    await websocket.send_json({"type": "done"})
                    continue

                # Send transcript
                await websocket.send_json({
                    "type": "transcript",
                    "text": transcript,
                })

                # Update conversation history
                conversation_history.append({"role": "user", "content": transcript})
                conversation_history.append({"role": "assistant", "content": response_text})

                # Trim to last N turns
                if len(conversation_history) > MAX_CONVERSATION_TURNS * 2:
                    sessions[session_id] = conversation_history[-(MAX_CONVERSATION_TURNS * 2):]

                # Send response text (for accessibility)
                await websocket.send_json({
                    "type": "response_text",
                    "text": response_text,
                })

                # Send audio in chunks (64KB each)
                chunk_size = 65536
                for i in range(0, len(audio), chunk_size):
                    chunk = audio[i : i + chunk_size]
                    await websocket.send_json({
                        "type": "audio_chunk",
                        "data": base64.b64encode(chunk).decode(),
                    })

                await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


# Serve frontend — must be last
frontend_path = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
