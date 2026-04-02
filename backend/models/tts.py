"""Piper TTS wrapper using ONNX Runtime."""
import json
import subprocess
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

    def _find_espeak(self):
        """Find espeak-ng binary."""
        import shutil
        path = shutil.which("espeak-ng")
        if path:
            return path
        # Common install locations
        for p in ["/opt/homebrew/bin/espeak-ng", "/usr/bin/espeak-ng", "/usr/local/bin/espeak-ng"]:
            if Path(p).exists():
                return p
        raise FileNotFoundError("espeak-ng not found. Install: brew install espeak-ng")

    def _text_to_phoneme_ids(self, text: str) -> list[int]:
        """Convert text to phoneme IDs using espeak-ng subprocess."""
        espeak = self._find_espeak()
        result = subprocess.run(
            [espeak, "-v", self.espeak_voice, "--ipa", "-q", text],
            capture_output=True, text=True, timeout=5,
        )
        phonemes = result.stdout.strip()

        ids = [0]  # BOS
        for char in phonemes:
            if char in self.phoneme_to_id:
                val = self.phoneme_to_id[char]
                # Config may store IDs as [int] or int
                pid = val[0] if isinstance(val, list) else val
                ids.append(pid)
                ids.append(0)  # pad
        ids.append(0)  # EOS
        return ids

    def synthesize(self, text: str, speed: float = 1.0) -> tuple[np.ndarray, int]:
        """Synthesize speech. Returns (float32 audio, sample_rate)."""
        phoneme_ids = self._text_to_phoneme_ids(text)

        if len(phoneme_ids) <= 2:  # only BOS+EOS
            return np.zeros(self.sample_rate, dtype=np.float32), self.sample_rate

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
