// ── Client-side Safety & Emotion Detection ──
// Ported from backend/safety.py and backend/emotion_detector.py

const SunnoSafety = (() => {
    const CRISIS_KEYWORDS = [
        "suicide", "kill myself", "end it all", "self harm", "want to die",
        "don't want to live", "no reason to live", "better off dead",
        "hurt myself", "cutting myself", "overdose", "jump off",
        "end my life", "take my life", "not worth living",
        "hang myself", "slit my wrist", "pills",
        // Hindi / Hinglish
        "khudkushi", "mar jana", "marna chahta", "marna chahti",
        "jeene ka mann nahi", "zindagi khatam", "mar jaunga", "mar jaungi",
        "khatam kar dunga", "khatam kar dungi", "jee nahi lagta",
        "maut chahiye", "marr jata", "marr jati",
    ];

    const HARM_KEYWORDS = [
        "kill them", "kill him", "kill her", "hurt them",
        "want to hurt", "beat them up", "maar dunga", "maar dungi",
    ];

    const SAFETY_RESPONSE =
        "Hey, I hear you, and this sounds really serious. I want to make sure you're safe. " +
        "iCall: 9152987821. Vandrevala Foundation: 1860-2662-345. They're really good.";

    const HARM_RESPONSE =
        "Hey, that sounds really intense. I'm here to listen. " +
        "If things feel out of control, talking to someone can help. " +
        "iCall: 9152987821. Vandrevala Foundation: 1860-2662-345.";

    function checkSafety(transcript) {
        const text = transcript.toLowerCase();

        for (const kw of CRISIS_KEYWORDS) {
            if (text.includes(kw)) return SAFETY_RESPONSE;
        }
        for (const kw of HARM_KEYWORDS) {
            if (text.includes(kw)) return HARM_RESPONSE;
        }
        return null;
    }

    // ── Emotion Detection ──
    const EMOTION_KEYWORDS = {
        angry: [
            "angry", "furious", "pissed", "mad", "hate", "frustrated",
            "annoying", "unfair", "bullshit", "ridiculous", "sick of",
            "gussa", "pagal", "bakwas", "bewkoof", "chutiya", "saala",
            "nafrat", "kameena", "harami", "jhooth", "dhoka",
        ],
        sad: [
            "sad", "crying", "miss", "lonely", "hurt", "broken",
            "lost", "empty", "hollow", "grief", "depressed", "hopeless",
            "nobody cares", "all alone", "don't matter",
            "dukhi", "rona", "akela", "toot gaya", "toot gayi", "dard",
            "koi nahi hai", "takleef", "udaas", "tang aa gaya", "tang aa gayi",
        ],
        anxious: [
            "anxious", "worried", "scared", "panic", "nervous",
            "can't breathe", "overthinking", "restless", "what if",
            "freaking out", "losing my mind",
            "tension", "darr", "ghabra", "neend nahi", "chain nahi",
            "dimag kharab", "pareshaan", "soch soch ke",
        ],
        frustrated: [
            "stuck", "tired", "exhausted", "done", "give up",
            "fed up", "enough", "can't take", "over it", "burned out",
            "no point", "waste of time",
            "thak gaya", "thak gayi", "bas", "ho gaya", "ho gayi",
            "kya fayda", "bekar", "sar dard",
        ],
        numb: [
            "numb", "don't feel", "nothing matters", "don't care",
            "whatever", "blank", "shutdown", "zombie",
            "kuch feel nahi", "sab bekar", "farq nahi padta",
            "koi matlab nahi", "sab same",
        ],
        positive: [
            "happy", "good", "better", "relieved", "grateful",
            "thanks", "laugh", "smile", "excited", "proud",
            "khush", "shukriya", "accha laga", "maza aa gaya",
            "theek", "badiya", "sahi hai",
        ],
    };

    function detectEmotion(transcript) {
        const text = transcript.toLowerCase();
        const scores = {};

        for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
            scores[emotion] = keywords.filter(kw => text.includes(kw)).length;
        }

        let best = "neutral";
        let bestScore = 0;
        for (const [emotion, score] of Object.entries(scores)) {
            if (score > bestScore) {
                best = emotion;
                bestScore = score;
            }
        }
        return bestScore > 0 ? best : "neutral";
    }

    return { checkSafety, detectEmotion };
})();
