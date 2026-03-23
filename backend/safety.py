CRISIS_KEYWORDS = [
    "suicide", "kill myself", "end it all", "self harm", "want to die",
    "don't want to live", "no reason to live", "better off dead",
    "hurt myself", "cutting myself", "overdose", "jump off",
    "khudkushi", "mar jana", "marna chahta", "marna chahti",
    "jeene ka mann nahi", "zindagi khatam",
]

SAFETY_RESPONSE = (
    "Hey, I hear you, and this sounds really serious. I want to make sure you're safe. "
    "iCall: 9152987821. Vandrevala Foundation: 1860-2662-345. They're really good."
)


def check_safety(transcript: str) -> bool:
    """Returns True if crisis indicators detected."""
    text = transcript.lower()
    return any(keyword in text for keyword in CRISIS_KEYWORDS)
