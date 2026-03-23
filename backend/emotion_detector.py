EMOTION_KEYWORDS = {
    "angry": [
        "angry", "furious", "pissed", "mad", "hate", "frustrated",
        "annoying", "unfair", "bullshit", "ridiculous", "sick of",
        # Hinglish
        "gussa", "pagal", "bakwas", "bewkoof", "chutiya", "saala",
        "nafrat", "kameena", "harami", "jhooth", "dhoka",
    ],
    "sad": [
        "sad", "crying", "miss", "lonely", "hurt", "broken",
        "lost", "empty", "hollow", "grief", "depressed", "hopeless",
        "nobody cares", "all alone", "don't matter",
        # Hinglish
        "dukhi", "rona", "akela", "toot gaya", "toot gayi", "dard",
        "koi nahi hai", "takleef", "udaas", "tang aa gaya", "tang aa gayi",
    ],
    "anxious": [
        "anxious", "worried", "scared", "panic", "nervous",
        "can't breathe", "overthinking", "restless", "what if",
        "freaking out", "losing my mind",
        # Hinglish
        "tension", "darr", "ghabra", "neend nahi", "chain nahi",
        "dimag kharab", "pareshaan", "soch soch ke",
    ],
    "frustrated": [
        "stuck", "tired", "exhausted", "done", "give up",
        "fed up", "enough", "can't take", "over it", "burned out",
        "no point", "waste of time",
        # Hinglish
        "thak gaya", "thak gayi", "bas", "ho gaya", "ho gayi",
        "kya fayda", "bekar", "sar dard",
    ],
    "numb": [
        "numb", "don't feel", "nothing matters", "don't care",
        "whatever", "blank", "shutdown", "zombie",
        # Hinglish
        "kuch feel nahi", "sab bekar", "farq nahi padta",
        "koi matlab nahi", "sab same",
    ],
    "positive": [
        "happy", "good", "better", "relieved", "grateful",
        "thanks", "laugh", "smile", "excited", "proud",
        # Hinglish
        "khush", "shukriya", "accha laga", "maza aa gaya",
        "theek", "badiya", "sahi hai",
    ],
}


def detect_emotion(transcript: str) -> str:
    """Keyword-based emotion detection with Hinglish support.
    Returns: 'angry', 'sad', 'anxious', 'frustrated', 'numb', 'positive', or 'neutral'
    """
    text = transcript.lower()
    scores = {}
    for emotion, keywords in EMOTION_KEYWORDS.items():
        scores[emotion] = sum(1 for kw in keywords if kw in text)

    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "neutral"
    return best
