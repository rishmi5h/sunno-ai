"""Silero VAD wrapper using ONNX Runtime."""
import numpy as np
import onnxruntime as ort


class SileroVAD:
    def __init__(self, model_path: str, threshold: float = 0.5):
        self.session = ort.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
        self.threshold = threshold
        self.sample_rate = 16000
        self._h = np.zeros((2, 1, 64), dtype=np.float32)
        self._c = np.zeros((2, 1, 64), dtype=np.float32)

    def reset_state(self):
        self._h = np.zeros((2, 1, 64), dtype=np.float32)
        self._c = np.zeros((2, 1, 64), dtype=np.float32)

    def is_speech(self, audio_chunk: np.ndarray) -> tuple[bool, float]:
        """Check if 512-sample chunk (32ms at 16kHz) contains speech."""
        if len(audio_chunk) != 512:
            raise ValueError(f"Expected 512 samples, got {len(audio_chunk)}")

        ort_inputs = {
            "input": audio_chunk.reshape(1, -1).astype(np.float32),
            "sr": np.array([self.sample_rate], dtype=np.int64),
            "h": self._h,
            "c": self._c,
        }

        output, self._h, self._c = self.session.run(None, ort_inputs)
        confidence = float(output[0][0])
        return confidence >= self.threshold, confidence
