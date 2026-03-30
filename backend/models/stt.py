"""Whisper ONNX wrapper for speech-to-text using optimum."""
import numpy as np
from optimum.onnxruntime import ORTModelForSpeechSeq2Seq
from transformers import WhisperProcessor


class WhisperSTT:
    def __init__(self, model_path: str, language: str = "hi"):
        self.processor = WhisperProcessor.from_pretrained(model_path)
        self.model = ORTModelForSpeechSeq2Seq.from_pretrained(
            model_path, provider="CPUExecutionProvider"
        )
        self.language = language
        self.forced_decoder_ids = self.processor.get_decoder_prompt_ids(
            language=language, task="transcribe"
        )

    def transcribe(self, audio: np.ndarray, sample_rate: int = 16000) -> str:
        """Transcribe float32 mono audio to text."""
        input_features = self.processor(
            audio, sampling_rate=sample_rate, return_tensors="np"
        ).input_features

        predicted_ids = self.model.generate(
            input_features,
            forced_decoder_ids=self.forced_decoder_ids,
            max_new_tokens=128,
        )

        return self.processor.batch_decode(
            predicted_ids, skip_special_tokens=True
        )[0].strip()

    def set_language(self, language: str):
        self.language = language
        self.forced_decoder_ids = self.processor.get_decoder_prompt_ids(
            language=language, task="transcribe"
        )
