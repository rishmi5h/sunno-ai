"""Singleton model manager — loads ONNX models once, reuses across requests."""
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

_pipeline = None
_loading = False


class ONNXPipeline:
    """Holds all loaded ONNX models."""

    def __init__(self, models_dir: str):
        from .stt import WhisperSTT
        from .emotion import EmotionClassifier
        from .tts import PiperTTS
        from .vad import SileroVAD

        models = Path(models_dir)
        t0 = time.time()
        logger.info("Loading ONNX models...")

        self.vad = SileroVAD(str(models / "silero_vad.onnx"))
        logger.info("  VAD loaded")

        self.stt = WhisperSTT(str(models / "whisper-small-onnx"))
        logger.info("  Whisper STT loaded")

        self.emotion = EmotionClassifier(str(models / "emotion-classifier-onnx"))
        logger.info("  Emotion classifier loaded")

        self.tts = PiperTTS(str(models / "piper-hi-IN"))
        logger.info("  Piper TTS loaded")

        elapsed = time.time() - t0
        logger.info(f"All ONNX models loaded in {elapsed:.1f}s")

        self._warmup()

    def _warmup(self):
        """Run dummy inference to trigger JIT compilation."""
        import numpy as np

        logger.info("Running warmup inference...")
        t0 = time.time()

        # Warmup VAD
        dummy_audio = np.zeros(512, dtype=np.float32)
        self.vad.is_speech(dummy_audio)
        self.vad.reset_state()

        # Warmup emotion
        self.emotion.detect("hello")

        # Warmup STT (short silence — just triggers graph compilation)
        dummy_speech = np.zeros(16000, dtype=np.float32)  # 1 second of silence
        self.stt.transcribe(dummy_speech)

        # Warmup TTS
        try:
            self.tts.synthesize("hello")
        except Exception as e:
            logger.warning(f"TTS warmup failed (espeak-ng may not be installed): {e}")

        logger.info(f"Warmup done in {time.time() - t0:.1f}s")


def get_pipeline(models_dir: str = None) -> ONNXPipeline | None:
    """Get or create the singleton ONNX pipeline."""
    global _pipeline, _loading

    if _pipeline is not None:
        return _pipeline

    if _loading:
        return None

    if models_dir is None:
        models_dir = str(Path(__file__).parent.parent.parent / "models")

    # Check if models exist
    models = Path(models_dir)
    required = [
        models / "silero_vad.onnx",
        models / "whisper-small-onnx" / "onnx" / "encoder_model.onnx",
        models / "emotion-classifier-onnx" / "model.onnx",
        models / "piper-hi-IN" / "model.onnx",
    ]

    missing = [p for p in required if not p.exists()]
    if missing:
        logger.warning(
            f"ONNX models not found: {[str(m) for m in missing]}. "
            "Run: python scripts/download_models.py"
        )
        return None

    _loading = True
    try:
        _pipeline = ONNXPipeline(models_dir)
    except Exception as e:
        logger.error(f"Failed to load ONNX models: {e}")
        _pipeline = None
    finally:
        _loading = False

    return _pipeline


def is_available() -> bool:
    """Check if ONNX pipeline is loaded and ready."""
    return _pipeline is not None
