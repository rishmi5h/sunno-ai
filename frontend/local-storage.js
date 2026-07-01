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

    // ── Mood Timeline (persisted across sessions, no expiry) ──
    const MOOD_LOG_MAX = 60;

    function getMoodLog() {
        try {
            const raw = getPreference("mood_log", null);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            // Newest first
            return arr.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
        } catch {
            return [];
        }
    }

    function addMoodEntry(entry) {
        // entry: { summary, mood, messageCount }
        if (!entry || !entry.summary || !entry.mood) return;
        try {
            const raw = getPreference("mood_log", null);
            const arr = raw ? (JSON.parse(raw) || []) : [];
            arr.push({
                ts: Math.floor(Date.now() / 1000),
                summary: String(entry.summary).slice(0, 200),
                mood: String(entry.mood).slice(0, 32),
                msgCount: Number(entry.messageCount) || 0,
            });
            // Trim to last MOOD_LOG_MAX (oldest dropped)
            const trimmed = arr.slice(-MOOD_LOG_MAX);
            setPreference("mood_log", JSON.stringify(trimmed));
        } catch {
            // Storage full or invalid — silent
        }
    }

    function clearMoodLog() {
        setPreference("mood_log", JSON.stringify([]));
    }

    function getMoodLogSummary() {
        const log = getMoodLog(); // newest first
        if (!log.length) {
            return { total: 0, daysActive: 0, dominantMood: null, last7Heaviness: 0, prev7Heaviness: 0 };
        }
        // Days active = unique YYYY-MM-DD across all entries
        const days = new Set();
        const moodCount = {};
        for (const e of log) {
            const d = new Date(e.ts * 1000);
            days.add(d.toISOString().slice(0, 10));
            moodCount[e.mood] = (moodCount[e.mood] || 0) + 1;
        }
        let dominantMood = null, max = 0;
        for (const [m, c] of Object.entries(moodCount)) {
            if (c > max) { max = c; dominantMood = m; }
        }

        // Heaviness score for trend (heavier moods score higher)
        const HEAVY = { heavy: 3, sad: 3, frustrated: 2, anxious: 2, mixed: 2, calm: 1, relieved: 0 };
        const now = Math.floor(Date.now() / 1000);
        const week = 7 * 86400;
        const last7 = log.filter(e => e.ts >= now - week);
        const prev7 = log.filter(e => e.ts < now - week && e.ts >= now - 2 * week);
        const avg = arr => arr.length ? arr.reduce((s, e) => s + (HEAVY[e.mood] ?? 1), 0) / arr.length : 0;

        return {
            total: log.length,
            daysActive: days.size,
            dominantMood,
            last7Heaviness: avg(last7),
            prev7Heaviness: avg(prev7),
            last7Count: last7.length,
            prev7Count: prev7.length,
        };
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
        getMoodLog, addMoodEntry, clearMoodLog, getMoodLogSummary,
    };
})();
