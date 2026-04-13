import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")

# Claude model — haiku for speed, sonnet for quality
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")

# ElevenLabs voice config — flash model for lowest latency
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB")  # Adam - warm male voice
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")

# Groq fallback (free tier, ultra-fast Llama inference)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# ONNX model paths (relative to project root)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
MODELS_DIR = os.getenv("MODELS_DIR", os.path.join(_PROJECT_ROOT, "models"))
VAD_MODEL_PATH = os.getenv("VAD_MODEL_PATH", os.path.join(MODELS_DIR, "silero_vad.onnx"))
WHISPER_MODEL_PATH = os.getenv("WHISPER_MODEL_PATH", os.path.join(MODELS_DIR, "whisper-small-onnx"))
EMOTION_MODEL_PATH = os.getenv("EMOTION_MODEL_PATH", os.path.join(MODELS_DIR, "emotion-classifier-onnx"))
PIPER_MODEL_DIR = os.getenv("PIPER_MODEL_DIR", os.path.join(MODELS_DIR, "piper-hi-IN"))

# Razorpay
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
PREMIUM_PRICE_PAISE = 19900  # ₹199
PREMIUM_DURATION_DAYS = 30

# Feature flags
ONNX_ENABLED = os.getenv("ONNX_ENABLED", "true").lower() == "true"
LOG_LATENCY = os.getenv("LOG_LATENCY", "true").lower() == "true"

# Conversation settings
MAX_CONVERSATION_TURNS = 10
SESSION_EXPIRY_HOURS = 24
