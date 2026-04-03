"""Emotion detection from transcript using ONNX DistilBERT."""
import numpy as np
from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import AutoTokenizer


class EmotionClassifier:
    LABELS = ["sadness", "joy", "love", "anger", "fear", "surprise"]

    def __init__(self, model_path: str):
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = ORTModelForSequenceClassification.from_pretrained(
            model_path, provider="CPUExecutionProvider"
        )

    def detect(self, text: str) -> dict:
        """Returns {"emotion": "sadness", "confidence": 0.87}."""
        inputs = self.tokenizer(
            text, return_tensors="np", truncation=True, max_length=128
        )
        outputs = self.model(**inputs)
        logits = outputs.logits[0]

        exp_logits = np.exp(logits - np.max(logits))
        probs = exp_logits / exp_logits.sum()

        idx = int(np.argmax(probs))
        return {"emotion": self.LABELS[idx], "confidence": float(probs[idx])}
