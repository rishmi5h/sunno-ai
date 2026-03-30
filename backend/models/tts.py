"""Piper TTS wrapper using ONNX Runtime."""
import json
import numpy as np
import onnxruntime as ort
from pathlib import Path


class PiperTTS:
    def __init__(self, model_dir: str):
        model_dir = Path(model_dir)
        self.session = ort.InferenceSession(
            str(model_dir / "model.onnx"),
            providers=["CPUExecutionProvider"],
        )

        with open(model_dir / "model.onnx.json", "r") as f:
            self.config = json.load(f)

        self.sample_rate = self.config["audio"]["sample_rate"]
        self.phoneme_to_id = self.config.get("phoneme_id_map", {})
        self.espeak_voice = self.config.get("espeak", {}).get("voice", "hi")

    def _text_to_phoneme_ids(self, text: str) -> list[int]:
        from piper_phonemize import phonemize_espeak

        phonemes_list = phonemize_espeak(text, self.espeak_voice)
        ids = [0]  # BOS
        for sentence_phonemes in phonemes_list:
            for char in sentence_phonemes:
                if char in self.phoneme_to_id:
                    ids.append(self.phoneme_to_id[char])
                    ids.append(0)  # pad
        ids.append(0)  # EOS
        return ids

    def synthesize(self, text: str, speed: float = 1.0) -> tuple[np.ndarray, int]:
        """Synthesize speech. Returns (float32 audio, sample_rate)."""
        phoneme_ids = self._text_to_phoneme_ids(text)

        audio = self.session.run(
            None,
            {
                "input": np.array([phoneme_ids], dtype=np.int64),
                "input_lengths": np.array([len(phoneme_ids)], dtype=np.int64),
                "scales": np.array([0.667, speed, 0.8], dtype=np.float32),
            },
        )[0]

        audio = audio.squeeze()
        audio = audio / (np.max(np.abs(audio)) + 1e-8)
        return audio, self.sample_rate
