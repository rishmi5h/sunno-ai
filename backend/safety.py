import logging
import re

logger = logging.getLogger(__name__)

CRISIS_KEYWORDS = [
    # English
    "suicide", "kill myself", "end it all", "self harm", "want to die",
    "don't want to live", "no reason to live", "better off dead",
    "hurt myself", "cutting myself", "overdose", "jump off",
    "end my life", "take my life", "not worth living",
    "hang myself", "slit my wrist", "pills",
    # Hindi / Hinglish
    "khudkushi", "mar jana", "marna chahta", "marna chahti",
    "jeene ka mann nahi", "zindagi khatam", "mar jaunga", "mar jaungi",
    "khatam kar dunga", "khatam kar dungi", "jee nahi lagta",
    "maut chahiye", "marr jata", "marr jati",
]

# Patterns that might indicate harm to others
HARM_KEYWORDS = [
    "kill them", "kill him", "kill her", "hurt them",
    "want to hurt", "beat them up", "maar dunga", "maar dungi",
]

SAFETY_RESPONSE = (
    "Hey, I hear you, and this sounds really serious. I want to make sure you're safe. "
    "iCall: 9152987821. Vandrevala Foundation: 1860-2662-345. They're really good."
)

HARM_RESPONSE = (
    "Hey, that sounds really intense. I'm here to listen. "
    "If things feel out of control, talking to someone can help. "
    "iCall: 9152987821. Vandrevala Foundation: 1860-2662-345."
)


def check_safety(transcript: str) -> str | None:
    """Check for crisis indicators.
    Returns safety response string if crisis detected, None otherwise.
    """
    text = transcript.lower()

    for keyword in CRISIS_KEYWORDS:
        if keyword in text:
            logger.warning(f"Crisis keyword detected: {keyword}")
            return SAFETY_RESPONSE

    for keyword in HARM_KEYWORDS:
        if keyword in text:
            logger.warning(f"Harm keyword detected: {keyword}")
            return HARM_RESPONSE

    return None
