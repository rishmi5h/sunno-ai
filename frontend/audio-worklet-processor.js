/**
 * AudioWorklet processor that captures raw PCM audio and resamples to 16kHz mono.
 * Runs in the audio rendering thread for low-latency capture.
 */
class PCMCaptureProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.targetRate = 16000;
        this.inputRate = options.processorOptions?.sampleRate || 48000;
        this.ratio = this.inputRate / this.targetRate;
        this.resampleBuffer = [];
        this.resampleIndex = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        // Take first channel (mono)
        const samples = input[0];

        // Resample to 16kHz using linear interpolation
        for (let i = 0; i < samples.length; i++) {
            this.resampleBuffer.push(samples[i]);
        }

        // Output resampled chunks of 512 samples (32ms at 16kHz)
        while (this.resampleBuffer.length >= this.ratio * 512) {
            const chunk = new Float32Array(512);
            for (let i = 0; i < 512; i++) {
                const srcIdx = i * this.ratio;
                const lo = Math.floor(srcIdx);
                const hi = Math.min(lo + 1, this.resampleBuffer.length - 1);
                const frac = srcIdx - lo;
                chunk[i] = this.resampleBuffer[lo] * (1 - frac) + this.resampleBuffer[hi] * frac;
            }
            this.port.postMessage({ type: "pcm_chunk", data: chunk.buffer }, [chunk.buffer]);
            this.resampleBuffer.splice(0, Math.floor(this.ratio * 512));
        }

        return true;
    }
}

registerProcessor("pcm-capture-processor", PCMCaptureProcessor);
