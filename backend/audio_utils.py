"""Audio conversion utilities for the ONNX pipeline."""
import base64
import io
import struct
import numpy as np


def pcm_base64_to_numpy(b64_data: str) -> np.ndarray:
    """Convert base64-encoded PCM float32 audio to numpy array."""
    raw = base64.b64decode(b64_data)
    if len(raw) % 4 != 0:
        raise ValueError(f"PCM data length {len(raw)} not aligned to float32")
    arr = np.frombuffer(raw, dtype=np.float32)
    if not np.all(np.isfinite(arr)):
        raise ValueError("PCM data contains NaN or Inf values")
    return arr


def numpy_to_wav_base64(audio: np.ndarray, sample_rate: int) -> str:
    """Convert numpy float32 audio to base64-encoded WAV."""
    # Convert to int16 for WAV
    audio_int16 = (audio * 32767).astype(np.int16)
    buf = io.BytesIO()

    # Write WAV header
    num_samples = len(audio_int16)
    data_size = num_samples * 2  # 16-bit = 2 bytes per sample
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))  # chunk size
    buf.write(struct.pack("<H", 1))   # PCM format
    buf.write(struct.pack("<H", 1))   # mono
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * 2))  # byte rate
    buf.write(struct.pack("<H", 2))   # block align
    buf.write(struct.pack("<H", 16))  # bits per sample
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(audio_int16.tobytes())

    return base64.b64encode(buf.getvalue()).decode("ascii")


def webm_to_pcm_16k(webm_bytes: bytes) -> np.ndarray | None:
    """Convert WebM/Opus audio to 16kHz mono float32 PCM using ffmpeg."""
    import subprocess
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-i", "pipe:0",
                "-ar", "16000", "-ac", "1", "-f", "f32le",
                "-acodec", "pcm_f32le", "pipe:1",
            ],
            input=webm_bytes,
            capture_output=True,
            timeout=10,
        )
        if result.returncode != 0:
            return None
        return np.frombuffer(result.stdout, dtype=np.float32)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
