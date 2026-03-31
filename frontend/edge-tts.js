// ── SpeechSynthesis TTS Wrapper ──
// Uses browser's built-in text-to-speech for zero-latency, on-device voice

const SunnoTTS = (() => {
    let selectedVoice = null;
    let currentMoodParams = { rate: 0.9, pitch: 0.95, volume: 1.0 };

    const MOOD_VOICE_PARAMS = {
        default:    { rate: 0.9,  pitch: 0.95, volume: 1.0 },
        comforting: { rate: 0.8,  pitch: 0.85, volume: 0.9 },
        funny:      { rate: 1.05, pitch: 1.1,  volume: 1.0 },
        real:       { rate: 0.95, pitch: 0.8,  volume: 1.0 },
        chill:      { rate: 0.75, pitch: 0.9,  volume: 0.95 },
    };

    function setMood(mood) {
        currentMoodParams = MOOD_VOICE_PARAMS[mood] || MOOD_VOICE_PARAMS.default;
    }

    function setVoice(voice) {
        selectedVoice = voice;
    }

    function speak(text, { onStart, onEnd, onError } = {}) {
        return new Promise((resolve, reject) => {
            // Cancel any ongoing speech
            speechSynthesis.cancel();

            // Firefox needs a small delay after cancel before speaking
            const doSpeak = () => {
                const utterance = new SpeechSynthesisUtterance(text);

                if (selectedVoice) {
                    utterance.voice = selectedVoice;
                }

                utterance.rate = currentMoodParams.rate;
                utterance.pitch = currentMoodParams.pitch;
                utterance.volume = currentMoodParams.volume;

                // Chrome pause/resume workaround (skip for Firefox)
                const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
                let resumeInterval = null;

                utterance.onstart = () => {
                    if (onStart) onStart();
                    if (isChrome) {
                        resumeInterval = setInterval(() => {
                            if (!speechSynthesis.speaking) {
                                clearInterval(resumeInterval);
                                return;
                            }
                            speechSynthesis.pause();
                            speechSynthesis.resume();
                        }, 10000);
                    }
                };

                utterance.onend = () => {
                    if (resumeInterval) clearInterval(resumeInterval);
                    if (onEnd) onEnd();
                    resolve();
                };

                utterance.onerror = (event) => {
                    if (resumeInterval) clearInterval(resumeInterval);
                    // Firefox fires "interrupted" error on cancel — ignore it
                    if (event.error === "interrupted" || event.error === "canceled") {
                        resolve();
                        return;
                    }
                    if (onError) onError(event);
                    reject(event);
                };

                speechSynthesis.speak(utterance);
            };

            // Firefox needs ~50ms after cancel before new speak()
            setTimeout(doSpeak, 50);
        });
    }

    function getVoice() {
        return selectedVoice;
    }

    function preview(text, voice) {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        if (voice) utterance.voice = voice;
        utterance.rate = currentMoodParams.rate;
        utterance.pitch = currentMoodParams.pitch;
        utterance.volume = currentMoodParams.volume;
        speechSynthesis.speak(utterance);
    }

    function stop() {
        speechSynthesis.cancel();
    }

    return { setVoice, getVoice, setMood, speak, preview, stop };
})();
