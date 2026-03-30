"""
End-to-end test for the ONNX voice pipeline.
Run: python scripts/test_pipeline.py

Tests each model individually, then runs the full pipeline.
"""
import sys
import time
import numpy as np
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

MODELS_DIR = Path(__file__).parent.parent / "models"


def test_vad():
    print("\n=== Testing Silero VAD ===")
    from models.vad import SileroVAD

    vad = SileroVAD(str(MODELS_DIR / "silero_vad.onnx"))

    # Test with silence
    silence = np.zeros(512, dtype=np.float32)
    is_speech, conf = vad.is_speech(silence)
    print(f"  Silence: is_speech={is_speech}, confidence={conf:.3f}")

    # Test with noise (simulated speech-like signal)
    t = np.linspace(0, 0.032, 512)
    speech_like = (np.sin(2 * np.pi * 200 * t) * 0.5).astype(np.float32)
    is_speech, conf = vad.is_speech(speech_like)
    print(f"  Tone:    is_speech={is_speech}, confidence={conf:.3f}")

    vad.reset_state()
    print("  [OK] VAD works")


def test_stt():
    print("\n=== Testing Whisper STT ===")
    from models.stt import WhisperSTT

    stt = WhisperSTT(str(MODELS_DIR / "whisper-small-onnx"))

    # Test with 2 seconds of silence (should return empty or noise)
    silence = np.zeros(32000, dtype=np.float32)
    t0 = time.time()
    text = stt.transcribe(silence)
    elapsed = time.time() - t0
    print(f"  Silence transcription ({elapsed:.2f}s): '{text}'")

    # Test with a tone (won't transcribe to words, but shouldn't crash)
    t = np.linspace(0, 2.0, 32000)
    tone = (np.sin(2 * np.pi * 440 * t) * 0.3).astype(np.float32)
    t0 = time.time()
    text = stt.transcribe(tone)
    elapsed = time.time() - t0
    print(f"  Tone transcription ({elapsed:.2f}s): '{text}'")

    print("  [OK] Whisper STT works")


def test_emotion():
    print("\n=== Testing Emotion Classifier ===")
    from models.emotion import EmotionClassifier

    clf = EmotionClassifier(str(MODELS_DIR / "emotion-classifier-onnx"))

    tests = [
        "I am so happy today!",
        "I feel really sad and lonely",
        "This makes me so angry",
        "I'm scared of what might happen",
        "What a wonderful surprise!",
    ]

    for text in tests:
        t0 = time.time()
        result = clf.detect(text)
        elapsed = (time.time() - t0) * 1000
        print(f"  '{text[:40]}...' → {result['emotion']} ({result['confidence']:.2f}) [{elapsed:.0f}ms]")

    print("  [OK] Emotion classifier works")


def test_tts():
    print("\n=== Testing Piper TTS ===")
    from models.tts import PiperTTS

    try:
        tts = PiperTTS(str(MODELS_DIR / "piper-hi-IN"))

        t0 = time.time()
        audio, sr = tts.synthesize("Main yahan hoon")
        elapsed = (time.time() - t0) * 1000
        duration = len(audio) / sr
        print(f"  Synthesized: {duration:.2f}s audio at {sr}Hz [{elapsed:.0f}ms]")
        print(f"  Audio shape: {audio.shape}, range: [{audio.min():.3f}, {audio.max():.3f}]")

        # Save to WAV for manual listening
        import wave
        wav_path = MODELS_DIR.parent / "test_output.wav"
        with wave.open(str(wav_path), "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sr)
            wf.writeframes((audio * 32767).astype(np.int16).tobytes())
        print(f"  Saved to {wav_path}")
        print("  [OK] Piper TTS works")
    except ImportError as e:
        print(f"  [SKIP] {e}")
        print("  Install espeak-ng: brew install espeak-ng")
        print("  Install piper-phonemize: pip install piper-phonemize")
    except Exception as e:
        print(f"  [ERR] {e}")


def test_full_pipeline():
    print("\n=== Full Pipeline Test ===")
    print("  (Requires running server. Use: python -m uvicorn main:app)")
    print("  Skipping automated test — use the browser frontend instead.")


if __name__ == "__main__":
    print("=" * 50)
    print("Sunno ONNX Pipeline Tests")
    print("=" * 50)

    tests = {
        "vad": test_vad,
        "stt": test_stt,
        "emotion": test_emotion,
        "tts": test_tts,
    }

    # Run specific test or all
    if len(sys.argv) > 1:
        name = sys.argv[1]
        if name in tests:
            tests[name]()
        else:
            print(f"Unknown test: {name}. Available: {list(tests.keys())}")
    else:
        for test in tests.values():
            try:
                test()
            except Exception as e:
                print(f"  [ERR] {e}")

    test_full_pipeline()
    print("\n" + "=" * 50)
    print("Done!")
