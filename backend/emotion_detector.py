EMOTION_KEYWORDS = {
    "angry": [
        "angry", "furious", "pissed", "mad", "hate", "gussa", "frustrated",
        "annoying", "unfair", "bullshit", "bakwas", "pagal",
    ],
    "sad": [
        "sad", "crying", "miss", "lonely", "hurt", "broken", "dukhi",
        "rona", "akela", "pain", "lost", "empty", "hollow",
    ],
    "anxious": [
        "anxious", "worried", "scared", "panic", "nervous", "tension",
        "darr", "ghabra", "stress", "can't breathe", "overthinking",
    ],
    "frustrated": [
        "stuck", "tired", "exhausted", "done", "give up", "thak gaya",
        "fed up", "enough", "can't take", "bas", "ho gaya",
    ],
    "positive": [
        "happy", "good", "better", "khush", "relieved", "grateful",
        "thanks", "shukriya", "accha laga", "nice",
    ],
}


def detect_emotion(transcript: str) -> str:
    """Simple keyword-based emotion detection.
    Returns: 'angry', 'sad', 'anxious', 'frustrated', 'positive', or 'neutral'
    """
    text = transcript.lower()
    scores = {}
    for emotion, keywords in EMOTION_KEYWORDS.items():
        scores[emotion] = sum(1 for kw in keywords if kw in text)

    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "neutral"
    return best
