"""Whisper ONNX wrapper for speech-to-text using optimum pipeline."""
import numpy as np
from pathlib import Path


class WhisperSTT:
    def __init__(self, model_path: str, language: str = "hi"):
        from optimum.onnxruntime import ORTModelForSpeechSeq2Seq
        from transformers import WhisperProcessor, AutomaticSpeechRecognitionPipeline

        model_dir = Path(model_path)
        subfolder = "onnx" if (model_dir / "onnx").is_dir() else None

        self.processor = WhisperProcessor.from_pretrained(model_path)
        self.model = ORTModelForSpeechSeq2Seq.from_pretrained(
            model_path, provider="CPUExecutionProvider",
            subfolder=subfolder,
        )
        self.language = language

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000) -> str:
        """Transcribe float32 mono audio to text."""
        input_features = self.processor(
            audio, sampling_rate=sample_rate, return_tensors="pt"
        ).input_features

        # Use low-level generate to avoid pipeline compatibility issues
        predicted_ids = self.model.generate(
            input_features,
            max_new_tokens=128,
        )

        return self.processor.batch_decode(
            predicted_ids, skip_special_tokens=True
        )[0].strip()

    def set_language(self, language: str):
        self.language = language
