import asyncio
import logging

import anthropic
from deepgram import DeepgramClient
from elevenlabs import ElevenLabs

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
from safety import SAFETY_RESPONSE, check_safety

logger = logging.getLogger(__name__)

# Lazy-init clients (allows server to start without keys for frontend dev)
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
    response = await asyncio.to_thread(
        lambda: get_deepgram().listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-2",
            smart_format=True,
            detect_language=True,
        )
    )
    transcript = response.results.channels[0].alternatives[0].transcript
    return transcript


async def generate_response(
    transcript: str, conversation_history: list[dict],
) -> str:
    """Generate a listener response using Claude."""
    if check_safety(transcript):
        return SAFETY_RESPONSE

    emotion = detect_emotion(transcript)
    emotion_context = f"[The person seems to be feeling {emotion}.]" if emotion != "neutral" else ""

    messages = []
    for turn in conversation_history:
        messages.append({"role": turn["role"], "content": turn["content"]})

    user_content = transcript
    if emotion_context:
        user_content = f"{emotion_context}\n\n{transcript}"
    messages.append({"role": "user", "content": user_content})

    response = await get_anthropic().messages.create(
        model=CLAUDE_MODEL,
        max_tokens=150,
        system=LISTENER_SYSTEM_PROMPT,
        messages=messages,
    )
    return response.content[0].text


def synthesize_speech(text: str) -> bytes:
    """Convert text to speech using ElevenLabs. Returns mp3 bytes."""
    audio_generator = get_elevenlabs().text_to_speech.convert(
        voice_id=ELEVENLABS_VOICE_ID,
        text=text,
        model_id=ELEVENLABS_MODEL_ID,
        output_format="mp3_44100_64",
    )
    audio_bytes = b""
    for chunk in audio_generator:
        audio_bytes += chunk
    return audio_bytes


async def process_voice(
    audio_bytes: bytes, conversation_history: list[dict],
) -> tuple[str, str, bytes]:
    """Full voice pipeline: STT -> LLM -> TTS.
    Returns (transcript, response_text, audio_bytes).
    """
    transcript = await transcribe_audio(audio_bytes)
    if not transcript.strip():
        return "", "", b""

    logger.info(f"Transcript: {transcript}")

    response_text = await generate_response(transcript, conversation_history)
    logger.info(f"Response: {response_text}")

    audio = await asyncio.to_thread(synthesize_speech, response_text)

    return transcript, response_text, audio
