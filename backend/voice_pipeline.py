import asyncio
import base64
import logging
import time
from typing import Callable, Awaitable

import anthropic
from deepgram import DeepgramClient
from elevenlabs import ElevenLabs
from elevenlabs.types import VoiceSettings

from config import (
    ANTHROPIC_API_KEY,
    CLAUDE_MODEL,
    DEEPGRAM_API_KEY,
    ELEVENLABS_API_KEY,
    ELEVENLABS_MODEL_ID,
    ELEVENLABS_VOICE_ID,
)
from emotion_detector import detect_emotion
from listener_prompt import LISTENER_SYSTEM_PROMPT
from safety import check_safety

logger = logging.getLogger(__name__)

# Lazy-init clients
_deepgram = None
_anthropic = None
_elevenlabs = None


def get_deepgram():
    global _deepgram
    if _deepgram is None:
        _deepgram = DeepgramClient(api_key=DEEPGRAM_API_KEY)
    return _deepgram


def get_anthropic():
    global _anthropic
    if _anthropic is None:
        _anthropic = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic


def get_elevenlabs():
    global _elevenlabs
    if _elevenlabs is None:
        _elevenlabs = ElevenLabs(api_key=ELEVENLABS_API_KEY)
    return _elevenlabs


async def transcribe_audio(audio_bytes: bytes) -> str:
    """Transcribe audio bytes using Deepgram v6 prerecorded API."""
    if not DEEPGRAM_API_KEY:
        raise ValueError("DEEPGRAM_API_KEY not set. Add it to your .env file.")

    t0 = time.monotonic()
    response = await asyncio.to_thread(
        lambda: get_deepgram().listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-2",
            smart_format=True,
            detect_language=True,
        )
    )
    transcript = response.results.channels[0].alternatives[0].transcript
    logger.info(f"STT took {time.monotonic() - t0:.2f}s: '{transcript}'")
    return transcript


async def generate_response_streaming(
    transcript: str,
    conversation_history: list[dict],
) -> str:
    """Generate a listener response using Claude with streaming."""
    if not ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not set. Add it to your .env file.")

    safety_response = check_safety(transcript)
    if safety_response:
        return safety_response

    emotion = detect_emotion(transcript)
    emotion_context = f"[The person seems to be feeling {emotion}.]" if emotion != "neutral" else ""

    messages = []
    for turn in conversation_history:
        messages.append({"role": turn["role"], "content": turn["content"]})

    user_content = transcript
    if emotion_context:
        user_content = f"{emotion_context}\n\n{transcript}"
    messages.append({"role": "user", "content": user_content})

    t0 = time.monotonic()
    full_text = ""
    async with get_anthropic().messages.stream(
        model=CLAUDE_MODEL,
        max_tokens=150,
        system=LISTENER_SYSTEM_PROMPT,
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            full_text += text

    logger.info(f"LLM took {time.monotonic() - t0:.2f}s: '{full_text}'")
    return full_text


def synthesize_speech_streaming(text: str):
    """Stream TTS audio from ElevenLabs. Yields mp3 chunks."""
    if not ELEVENLABS_API_KEY:
        raise ValueError("ELEVENLABS_API_KEY not set. Add it to your .env file.")
    return get_elevenlabs().text_to_speech.convert(
        voice_id=ELEVENLABS_VOICE_ID,
        text=text,
        model_id=ELEVENLABS_MODEL_ID,
        output_format="mp3_44100_64",
        voice_settings=VoiceSettings(
            stability=0.6,
            similarity_boost=0.75,
            speed=0.85,
        ),
    )


async def process_voice_streaming(
    audio_bytes: bytes,
    conversation_history: list[dict],
    send_message: Callable[[dict], Awaitable[None]],
) -> tuple[str, str]:
    """Streaming voice pipeline: STT → LLM → TTS with real-time audio delivery.
    Sends audio chunks to the client as they arrive from TTS.
    Returns (transcript, response_text).
    """
    t_start = time.monotonic()

    # Step 1: Transcribe
    transcript = await transcribe_audio(audio_bytes)
    if not transcript.strip():
        return "", ""

    await send_message({"type": "transcript", "text": transcript})

    # Step 2: Generate response (streaming from Claude)
    response_text = await generate_response_streaming(transcript, conversation_history)

    await send_message({"type": "response_text", "text": response_text})

    # Step 3: Stream TTS audio chunks directly to client
    t0 = time.monotonic()
    chunk_count = 0

    def _stream_tts():
        nonlocal chunk_count
        chunks = []
        for chunk in synthesize_speech_streaming(response_text):
            chunks.append(chunk)
            chunk_count += 1
        return chunks

    audio_chunks = await asyncio.to_thread(_stream_tts)

    # Send chunks to client
    for chunk in audio_chunks:
        await send_message({
            "type": "audio_chunk",
            "data": base64.b64encode(chunk).decode(),
        })

    logger.info(f"TTS took {time.monotonic() - t0:.2f}s ({chunk_count} chunks)")
    logger.info(f"Total pipeline: {time.monotonic() - t_start:.2f}s")

    return transcript, response_text
