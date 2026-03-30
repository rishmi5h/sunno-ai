"""
Downloads all ONNX models needed for Sunno's hybrid voice pipeline.
Run once: python scripts/download_models.py
Models are cached in ./models/ (gitignored).
"""
import os
import sys
import requests
from pathlib import Path

# Add parent dir to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

MODELS_DIR = Path(__file__).parent.parent / "models"
MODELS_DIR.mkdir(exist_ok=True)


def download_file(url: str, dest: Path, name: str):
    if dest.exists():
        print(f"  [OK] {name} already exists ({dest.stat().st_size / 1e6:.1f}MB)")
        return
    print(f"  [DL] Downloading {name}...")
    response = requests.get(url, stream=True, allow_redirects=True)
    response.raise_for_status()
    total = int(response.headers.get("content-length", 0))
    downloaded = 0
    with open(dest, "wb") as f:
        for chunk in response.iter_content(8192):
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = downloaded * 100 // total
                print(f"\r  [DL] {name}: {pct}% ({downloaded/1e6:.1f}/{total/1e6:.1f}MB)", end="", flush=True)
    print(f"\n  [OK] {name} saved ({dest.stat().st_size / 1e6:.1f}MB)")


def download_silero_vad():
    print("\n1. Silero VAD v5")
    url = "https://github.com/snakers4/silero-vad/raw/master/files/silero_vad.onnx"
    download_file(url, MODELS_DIR / "silero_vad.onnx", "Silero VAD")


def download_whisper():
    print("\n2. Whisper Small (ONNX)")
    whisper_dir = MODELS_DIR / "whisper-small-onnx"
    if whisper_dir.exists() and (whisper_dir / "encoder_model.onnx").exists():
        print(f"  [OK] Whisper already exported at {whisper_dir}")
        return

    try:
        from huggingface_hub import snapshot_download
        print("  [DL] Downloading from onnx-community/whisper-small...")
        snapshot_download(
            "onnx-community/whisper-small",
            local_dir=str(whisper_dir),
            allow_patterns=["*.onnx", "*.json", "*.txt", "tokenizer*", "preprocessor*", "config*",
                            "generation_config*", "vocab*", "merges*", "special_tokens*",
                            "added_tokens*", "normalizer*"],
        )
        print(f"  [OK] Whisper downloaded to {whisper_dir}")
    except Exception as e:
        print(f"  [ERR] Failed: {e}")
        print("  [INFO] Try manually: optimum-cli export onnx --model openai/whisper-small ./models/whisper-small-onnx/")


def download_emotion_classifier():
    print("\n3. Emotion Classifier (DistilBERT)")
    emotion_dir = MODELS_DIR / "emotion-classifier-onnx"
    if emotion_dir.exists() and (emotion_dir / "model.onnx").exists():
        print(f"  [OK] Emotion classifier already exported at {emotion_dir}")
        return

    try:
        print("  [DL] Exporting bhadresh-savani/distilbert-base-uncased-emotion to ONNX...")
        from optimum.onnxruntime import ORTModelForSequenceClassification
        model = ORTModelForSequenceClassification.from_pretrained(
            "bhadresh-savani/distilbert-base-uncased-emotion",
            export=True,
        )
        model.save_pretrained(str(emotion_dir))
        # Also save tokenizer
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained("bhadresh-savani/distilbert-base-uncased-emotion")
        tokenizer.save_pretrained(str(emotion_dir))
        print(f"  [OK] Emotion classifier exported to {emotion_dir}")
    except Exception as e:
        print(f"  [ERR] Failed: {e}")


def download_piper_tts():
    print("\n4. Piper TTS (Hindi voice)")
    piper_dir = MODELS_DIR / "piper-hi-IN"
    piper_dir.mkdir(exist_ok=True)

    model_path = piper_dir / "model.onnx"
    config_path = piper_dir / "model.onnx.json"

    # hi_IN-swara-medium voice
    base_url = "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/swara/medium"

    if not model_path.exists():
        download_file(f"{base_url}/hi_IN-swara-medium.onnx", model_path, "Piper Hindi model")
    else:
        print(f"  [OK] Piper model already exists ({model_path.stat().st_size / 1e6:.1f}MB)")

    if not config_path.exists():
        download_file(f"{base_url}/hi_IN-swara-medium.onnx.json", config_path, "Piper Hindi config")
    else:
        print("  [OK] Piper config already exists")


def verify_models():
    print("\n5. Verifying models load...")
    import onnxruntime as ort

    # VAD
    vad_path = MODELS_DIR / "silero_vad.onnx"
    if vad_path.exists():
        try:
            ort.InferenceSession(str(vad_path))
            print("  [OK] Silero VAD loads")
        except Exception as e:
            print(f"  [ERR] Silero VAD: {e}")

    # Whisper
    whisper_dir = MODELS_DIR / "whisper-small-onnx"
    encoder = whisper_dir / "encoder_model.onnx"
    if encoder.exists():
        try:
            ort.InferenceSession(str(encoder))
            print("  [OK] Whisper encoder loads")
        except Exception as e:
            print(f"  [ERR] Whisper encoder: {e}")

    # Emotion
    emotion_dir = MODELS_DIR / "emotion-classifier-onnx"
    emotion_model = emotion_dir / "model.onnx"
    if emotion_model.exists():
        try:
            ort.InferenceSession(str(emotion_model))
            print("  [OK] Emotion classifier loads")
        except Exception as e:
            print(f"  [ERR] Emotion classifier: {e}")

    # Piper
    piper_model = MODELS_DIR / "piper-hi-IN" / "model.onnx"
    if piper_model.exists():
        try:
            ort.InferenceSession(str(piper_model))
            print("  [OK] Piper TTS loads")
        except Exception as e:
            print(f"  [ERR] Piper TTS: {e}")


if __name__ == "__main__":
    print("=" * 50)
    print("Sunno ONNX Model Downloader")
    print("=" * 50)

    download_silero_vad()
    download_whisper()
    download_emotion_classifier()
    download_piper_tts()
    verify_models()

    print("\n" + "=" * 50)
    print("Done! Models cached in ./models/")
    print("=" * 50)
