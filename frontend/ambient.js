// ── Ambient Sound Generator ──
// Programmatic Web Audio API ambient sounds (no audio files needed)

const SunnoAmbient = (() => {
    let audioCtx = null;
    let masterGain = null;
    let currentSound = "silence";
    let currentNodes = [];
    let volume = 0.3; // 0.0 - 0.6
    let isStarted = false;

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0;
            masterGain.connect(audioCtx.destination);
        }
        return audioCtx;
    }

    function createNoiseBuffer(seconds, type) {
        const ctx = getAudioContext();
        const sampleRate = ctx.sampleRate;
        const length = sampleRate * seconds;
        const buffer = ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        if (type === "white") {
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        } else if (type === "brown") {
            let last = 0;
            for (let i = 0; i < length; i++) {
                const white = Math.random() * 2 - 1;
                data[i] = (last + 0.02 * white) / 1.02;
                last = data[i];
                data[i] *= 3.5;
            }
        }
        return buffer;
    }

    function stopCurrentNodes() {
        for (const node of currentNodes) {
            try {
                if (node.stop) node.stop();
                if (node.disconnect) node.disconnect();
            } catch {}
        }
        currentNodes = [];
    }

    function startRain() {
        const ctx = getAudioContext();
        const noiseBuffer = createNoiseBuffer(4, "white");

        // Layer 1: main rain (lowpass ~800Hz)
        const source1 = ctx.createBufferSource();
        source1.buffer = noiseBuffer;
        source1.loop = true;
        const filter1 = ctx.createBiquadFilter();
        filter1.type = "lowpass";
        filter1.frequency.value = 800;
        filter1.Q.value = 0.5;
        const gain1 = ctx.createGain();
        gain1.gain.value = 0.7;
        source1.connect(filter1);
        filter1.connect(gain1);
        gain1.connect(masterGain);
        source1.start();

        // Layer 2: deeper rumble (lowpass ~400Hz)
        const source2 = ctx.createBufferSource();
        source2.buffer = createNoiseBuffer(4, "brown");
        source2.loop = true;
        const filter2 = ctx.createBiquadFilter();
        filter2.type = "lowpass";
        filter2.frequency.value = 400;
        const gain2 = ctx.createGain();
        gain2.gain.value = 0.4;
        source2.connect(filter2);
        filter2.connect(gain2);
        gain2.connect(masterGain);
        source2.start();

        // LFO for natural variation on layer 1
        const lfo = ctx.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = 0.15;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.15;
        lfo.connect(lfoGain);
        lfoGain.connect(gain1.gain);
        lfo.start();

        currentNodes = [source1, filter1, gain1, source2, filter2, gain2, lfo, lfoGain];
    }

    function startLofi() {
        const ctx = getAudioContext();

        // Low bass hum
        const bass = ctx.createOscillator();
        bass.type = "sine";
        bass.frequency.value = 70;
        const bassGain = ctx.createGain();
        bassGain.gain.value = 0.15;
        bass.connect(bassGain);
        bassGain.connect(masterGain);
        bass.start();

        // Warm filtered noise bed
        const noiseBuffer = createNoiseBuffer(4, "brown");
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;
        noise.loop = true;
        const bandpass = ctx.createBiquadFilter();
        bandpass.type = "bandpass";
        bandpass.frequency.value = 400;
        bandpass.Q.value = 0.8;
        const noiseGain = ctx.createGain();
        noiseGain.gain.value = 0.35;
        noise.connect(bandpass);
        bandpass.connect(noiseGain);
        noiseGain.connect(masterGain);
        noise.start();

        // Gentle rhythmic pulse via gain LFO
        const pulseLfo = ctx.createOscillator();
        pulseLfo.type = "sine";
        pulseLfo.frequency.value = 0.5;
        const pulseDepth = ctx.createGain();
        pulseDepth.gain.value = 0.08;
        pulseLfo.connect(pulseDepth);
        pulseDepth.connect(noiseGain.gain);
        pulseLfo.start();

        // Subtle high shimmer
        const shimmer = ctx.createOscillator();
        shimmer.type = "triangle";
        shimmer.frequency.value = 523; // C5
        const shimmerGain = ctx.createGain();
        shimmerGain.gain.value = 0.02;
        const shimmerFilter = ctx.createBiquadFilter();
        shimmerFilter.type = "lowpass";
        shimmerFilter.frequency.value = 600;
        shimmer.connect(shimmerFilter);
        shimmerFilter.connect(shimmerGain);
        shimmerGain.connect(masterGain);
        shimmer.start();

        currentNodes = [bass, bassGain, noise, bandpass, noiseGain, pulseLfo, pulseDepth, shimmer, shimmerFilter, shimmerGain];
    }

    function startCrickets() {
        const ctx = getAudioContext();

        // Quiet night atmosphere (brown noise, very low)
        const nightBuffer = createNoiseBuffer(4, "brown");
        const nightNoise = ctx.createBufferSource();
        nightNoise.buffer = nightBuffer;
        nightNoise.loop = true;
        const nightFilter = ctx.createBiquadFilter();
        nightFilter.type = "lowpass";
        nightFilter.frequency.value = 200;
        const nightGain = ctx.createGain();
        nightGain.gain.value = 0.15;
        nightNoise.connect(nightFilter);
        nightFilter.connect(nightGain);
        nightGain.connect(masterGain);
        nightNoise.start();

        const allNodes = [nightNoise, nightFilter, nightGain];

        // Create 3 cricket chirpers at different frequencies
        const freqs = [4800, 5200, 5600];
        for (const freq of freqs) {
            const osc = ctx.createOscillator();
            osc.type = "sine";
            osc.frequency.value = freq;

            const chirpGain = ctx.createGain();
            chirpGain.gain.value = 0;

            osc.connect(chirpGain);
            chirpGain.connect(masterGain);
            osc.start();

            allNodes.push(osc, chirpGain);

            // Chirp pattern: rapid on/off with random intervals
            const chirpInterval = setInterval(() => {
                if (currentSound !== "crickets") {
                    clearInterval(chirpInterval);
                    return;
                }
                const now = ctx.currentTime;
                const chirps = 2 + Math.floor(Math.random() * 4);
                for (let i = 0; i < chirps; i++) {
                    const t = now + i * 0.08;
                    chirpGain.gain.setValueAtTime(0.04 + Math.random() * 0.03, t);
                    chirpGain.gain.setValueAtTime(0, t + 0.04);
                }
            }, 800 + Math.random() * 2000);

            allNodes.push({ stop: () => clearInterval(chirpInterval), disconnect: () => {} });
        }

        currentNodes = allNodes;
    }

    function setSound(name) {
        stopCurrentNodes();
        currentSound = name;

        if (!isStarted || name === "silence") {
            if (masterGain) masterGain.gain.value = 0;
            return;
        }

        const ctx = getAudioContext();
        if (ctx.state === "suspended") ctx.resume();
        masterGain.gain.value = volume;

        switch (name) {
            case "rain": startRain(); break;
            case "lofi": startLofi(); break;
            case "crickets": startCrickets(); break;
        }
    }

    function setVolume(v) {
        volume = Math.min(0.6, v * 0.6); // Map 0-1 to 0-0.6
        if (masterGain && currentSound !== "silence") {
            masterGain.gain.value = volume;
        }
    }

    function getSound() { return currentSound; }
    function getVolume() { return volume / 0.6; } // Map back to 0-1

    function start() {
        isStarted = true;
        if (currentSound !== "silence") {
            setSound(currentSound);
        }
    }

    function stop() {
        isStarted = false;
        stopCurrentNodes();
        if (masterGain) masterGain.gain.value = 0;
    }

    return { setSound, setVolume, getSound, getVolume, getAudioContext, start, stop };
})();
