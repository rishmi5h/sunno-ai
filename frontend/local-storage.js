// ── Client-side Conversation History (localStorage) ──
// Mirrors backend/database.py but fully on-device

const SunnoStorage = (() => {
    const MAX_TURNS = 10; // Keep last 10 exchanges (20 messages)
    const EXPIRY_HOURS = 24;
    const KEY_PREFIX = "sunno_";

    function _sessionKey(sessionId) {
        return `${KEY_PREFIX}${sessionId}`;
    }

    function getHistory(sessionId) {
        try {
            const raw = localStorage.getItem(_sessionKey(sessionId));
            if (!raw) return [];

            const data = JSON.parse(raw);

            // Check expiry
            if (Date.now() - data.createdAt > EXPIRY_HOURS * 60 * 60 * 1000) {
                localStorage.removeItem(_sessionKey(sessionId));
                return [];
            }

            return data.messages || [];
        } catch {
            return [];
        }
    }

    function saveMessage(sessionId, role, content) {
        try {
            const key = _sessionKey(sessionId);
            const raw = localStorage.getItem(key);
            let data = raw ? JSON.parse(raw) : { createdAt: Date.now(), messages: [] };

            data.messages.push({ role, content });

            // Trim to last MAX_TURNS * 2 messages
            if (data.messages.length > MAX_TURNS * 2) {
                data.messages = data.messages.slice(-MAX_TURNS * 2);
            }

            localStorage.setItem(key, JSON.stringify(data));
        } catch {
            // Storage full or unavailable — silently continue
        }
    }

    function clearSession(sessionId) {
        localStorage.removeItem(_sessionKey(sessionId));
    }

    // Clean up expired sessions on load
    function cleanupExpired() {
        try {
            const now = Date.now();
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(KEY_PREFIX)) continue;
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (now - data.createdAt > EXPIRY_HOURS * 60 * 60 * 1000) {
                        localStorage.removeItem(key);
                    }
                } catch {
                    // Ignore malformed entries
                }
            }
        } catch {
            // Ignore
        }
    }

    // ── User Preferences ──
    const PREFS_KEY = "sunno_prefs";

    function getPreference(key, defaultValue) {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (!raw) return defaultValue;
            const prefs = JSON.parse(raw);
            return prefs[key] !== undefined ? prefs[key] : defaultValue;
        } catch {
            return defaultValue;
        }
    }

    function setPreference(key, value) {
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            const prefs = raw ? JSON.parse(raw) : {};
            prefs[key] = value;
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        } catch {
            // Storage full or unavailable
        }
    }

    function incrementMessageCount() {
        const count = getPreference("msg_count", 0);
        setPreference("msg_count", count + 1);
        return count + 1;
    }

    function getMessageCount() {
        return getPreference("msg_count", 0);
    }

    // Run cleanup on load
    cleanupExpired();

    return {
        getHistory, saveMessage, clearSession,
        getPreference, setPreference,
        incrementMessageCount, getMessageCount,
    };
})();
