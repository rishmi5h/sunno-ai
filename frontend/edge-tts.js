// ── SpeechSynthesis TTS Wrapper ──
// Uses browser's built-in text-to-speech for zero-latency, on-device voice

const SunnoTTS = (() => {
    let selectedVoice = null;

    function setVoice(voice) {
        selectedVoice = voice;
    }

    function speak(text, { onStart, onEnd, onError } = {}) {
        return new Promise((resolve, reject) => {
            // Cancel any ongoing speech
            speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text);

            if (selectedVoice) {
                utterance.voice = selectedVoice;
            }

            // Warm, slightly slower pace
            utterance.rate = 0.9;
            utterance.pitch = 0.95;
            utterance.volume = 1.0;

            utterance.onstart = () => {
                if (onStart) onStart();
            };

            utterance.onend = () => {
                if (onEnd) onEnd();
                resolve();
            };

            utterance.onerror = (event) => {
                if (onError) onError(event);
                reject(event);
            };

            speechSynthesis.speak(utterance);

            // Workaround: Chrome sometimes pauses long utterances
            // Resume periodically to prevent stalling
            const resumeInterval = setInterval(() => {
                if (!speechSynthesis.speaking) {
                    clearInterval(resumeInterval);
                    return;
                }
                speechSynthesis.pause();
                speechSynthesis.resume();
            }, 10000);

            utterance.onend = () => {
                clearInterval(resumeInterval);
                if (onEnd) onEnd();
                resolve();
            };

            utterance.onerror = (event) => {
                clearInterval(resumeInterval);
                if (onError) onError(event);
                reject(event);
            };
        });
    }

    function getVoice() {
        return selectedVoice;
    }

    function preview(text, voice) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        if (voice) utterance.voice = voice;
        utterance.rate = 0.9;
        utterance.pitch = 0.95;
        utterance.volume = 1.0;
        speechSynthesis.speak(utterance);
    }

    function stop() {
        speechSynthesis.cancel();
    }

    return { setVoice, getVoice, speak, preview, stop };
})();
