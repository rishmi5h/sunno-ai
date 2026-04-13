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

    // ── Usage Tracking (minutes-based freemium) ──
    const FREE_MINUTES_PER_DAY = 15;

    function _todayKey() {
        return new Date().toISOString().slice(0, 10); // "2026-04-05"
    }

    function getUsageToday() {
        const savedDate = getPreference("usage_date", "");
        if (savedDate !== _todayKey()) {
            // New day — reset usage
            setPreference("usage_date", _todayKey());
            setPreference("usage_seconds", 0);
            return 0;
        }
        return getPreference("usage_seconds", 0);
    }

    function addUsage(seconds) {
        const today = _todayKey();
        if (getPreference("usage_date", "") !== today) {
            setPreference("usage_date", today);
            setPreference("usage_seconds", 0);
        }
        const current = getPreference("usage_seconds", 0);
        setPreference("usage_seconds", current + seconds);
        return current + seconds;
    }

    function getRemainingMinutes() {
        const usedSeconds = getUsageToday();
        const remaining = FREE_MINUTES_PER_DAY - (usedSeconds / 60);
        return Math.max(0, Math.round(remaining * 10) / 10); // 1 decimal
    }

    function isLimitReached() {
        if (isPremiumUser()) return false;
        return getRemainingMinutes() <= 0;
    }

    function getUsagePercent() {
        const usedSeconds = getUsageToday();
        return Math.min(100, (usedSeconds / (FREE_MINUTES_PER_DAY * 60)) * 100);
    }

    // ── Premium Subscription ──
    const PREMIUM_KEY = "sunno_premium";

    function setPremium(email, expiresAt) {
        try {
            localStorage.setItem(PREMIUM_KEY, JSON.stringify({
                email: email.toLowerCase().trim(),
                expiresAt, // Unix timestamp (seconds)
            }));
        } catch {}
    }

    function getPremium() {
        try {
            const raw = localStorage.getItem(PREMIUM_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (data.expiresAt && data.expiresAt * 1000 < Date.now()) {
                localStorage.removeItem(PREMIUM_KEY);
                return null;
            }
            return data;
        } catch { return null; }
    }

    function clearPremium() {
        localStorage.removeItem(PREMIUM_KEY);
    }

    function isPremiumUser() {
        return getPremium() !== null;
    }

    // Run cleanup on load
    cleanupExpired();

    return {
        getHistory, saveMessage, clearSession,
        getPreference, setPreference,
        incrementMessageCount, getMessageCount,
        getUsageToday, addUsage, getRemainingMinutes,
        isLimitReached, getUsagePercent,
        FREE_MINUTES_PER_DAY,
        setPremium, getPremium, clearPremium, isPremiumUser,
    };
})();
