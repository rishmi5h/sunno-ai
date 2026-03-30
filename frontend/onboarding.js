// ── Sunno Onboarding: Progressive Contextual Hints ──
// Warm, non-blocking hints that reveal features at the right moment.
// Never blocks the user. Never shows the same hint twice.

const SunnoOnboarding = (() => {
    const HINTS = [
        { id: "language", text: "Sunno speaks Hindi, Tamil, Telugu & more. Tap ⚙️ anytime.", after: 1 },
        { id: "mood",     text: "Want a different vibe? Try changing the listener mood in settings.", after: 2 },
        { id: "ambient",  text: "Background sounds can help you relax. Try rain, lo-fi, or crickets in settings.", after: 3 },
    ];

    let activeHint = null;

    function getStage() {
        return SunnoStorage.getPreference("onboarding_stage", "fresh");
    }
    function setStage(s) {
        SunnoStorage.setPreference("onboarding_stage", s);
    }
    function getConvCount() {
        return parseInt(SunnoStorage.getPreference("onboarding_conversations", "0"), 10);
    }
    function incrementConvCount() {
        const c = getConvCount() + 1;
        SunnoStorage.setPreference("onboarding_conversations", String(c));
        return c;
    }
    function getSeenHints() {
        const raw = SunnoStorage.getPreference("hints_seen", "[]");
        try { return JSON.parse(raw); } catch { return []; }
    }
    function markHintSeen(id) {
        const seen = getSeenHints();
        if (!seen.includes(id)) {
            seen.push(id);
            SunnoStorage.setPreference("hints_seen", JSON.stringify(seen));
        }
    }

    // ── Landing page adjustments ──
    function initLanding() {
        // Existing users who predate onboarding
        if (getStage() === "fresh" && SunnoStorage.getMessageCount() > 0) {
            setStage("graduated");
            return;
        }
        if (getStage() !== "fresh") return;

        // First-time visitor: show simplified welcome, hide explainer cards
        const welcomeEl = document.getElementById("welcome-first");
        const tagline = document.querySelector(".tagline");
        const explainer = document.querySelector(".landing-explainer");

        if (welcomeEl) welcomeEl.classList.remove("hidden");
        if (tagline) tagline.classList.add("hidden");
        if (explainer) explainer.classList.add("hidden");
    }

    // ── Called when "Start talking" is tapped ──
    function onStartTalking() {
        if (getStage() === "fresh") {
            setStage("welcomed");
        }
    }

    // ── Called when session screen appears ──
    function onSessionStart() {
        if (getStage() === "welcomed") {
            setTimeout(() => {
                showHint("first-tap", "Tap the orb whenever you're ready. Take your time.", "center");
            }, 2000);
        }
    }

    // ── Called on orb tap ──
    function onOrbTap() {
        if (activeHint && activeHint.dataset.hintId === "first-tap") {
            dismissHint();
        }
    }

    // ── Called after each complete conversation ──
    function onConversationComplete() {
        const stage = getStage();
        if (stage === "graduated") return;

        // Mark first-tap as done
        if (stage === "welcomed") {
            setStage("first_talk");
        }

        const count = incrementConvCount();
        const seen = getSeenHints();

        // Find the next hint to show
        const nextHint = HINTS.find(h => h.after === count && !seen.includes(h.id));
        if (nextHint) {
            setTimeout(() => {
                showHint(nextHint.id, nextHint.text, "settings");
            }, 2000);
        }

        // Graduate after all hints
        if (count >= 3) {
            setStage("graduated");
        }
    }

    // ── Hint rendering ──
    function showHint(id, text, position) {
        dismissHint(); // Remove any existing hint

        const seen = getSeenHints();
        if (seen.includes(id)) return;

        const hint = document.createElement("div");
        hint.className = "onboarding-hint";
        hint.dataset.hintId = id;

        const textEl = document.createElement("p");
        textEl.className = "hint-text";
        textEl.textContent = text;

        const dismissBtn = document.createElement("button");
        dismissBtn.className = "hint-dismiss";
        dismissBtn.textContent = "\u00d7";
        dismissBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            dismissHint();
        });

        hint.appendChild(textEl);
        hint.appendChild(dismissBtn);

        // Position
        if (position === "center") {
            hint.style.bottom = "18%";
            hint.style.left = "50%";
            hint.style.transform = "translateX(-50%)";
        } else {
            // Near settings gear (top-right)
            hint.style.top = "3.5rem";
            hint.style.right = "1rem";
        }

        document.body.appendChild(hint);
        activeHint = hint;

        // Auto-dismiss after 6s
        hint._timer = setTimeout(() => dismissHint(), 6000);
    }

    function dismissHint() {
        if (!activeHint) return;
        const hint = activeHint;
        const id = hint.dataset.hintId;
        clearTimeout(hint._timer);
        markHintSeen(id);

        hint.classList.add("fading");
        setTimeout(() => {
            if (hint.parentNode) hint.parentNode.removeChild(hint);
        }, 400);
        activeHint = null;
    }

    return {
        initLanding,
        onStartTalking,
        onSessionStart,
        onOrbTap,
        onConversationComplete,
    };
})();
