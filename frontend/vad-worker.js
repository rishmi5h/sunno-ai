/**
 * Web Worker for Silero VAD using ONNX Runtime Web.
 * Receives 512-sample PCM chunks (16kHz), detects speech start/end.
 *
 * Messages IN:
 *   { type: "init", modelUrl: "silero_vad.onnx" }
 *   { type: "audio", data: Float32Array(512) }
 *   { type: "reset" }
 *
 * Messages OUT:
 *   { type: "ready" }
 *   { type: "speech_start" }
 *   { type: "speech_end" }
 *   { type: "vad_score", score: 0.95 }
 *   { type: "error", message: "..." }
 */

importScripts("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.wasm.min.js");

let session = null;
let h = null;
let c = null;
// Use regular Int32 tensor — Silero VAD accepts both int64 and int32 for sample rate
const SR = typeof BigInt64Array !== "undefined"
    ? new BigInt64Array([BigInt(16000)])
    : new Int32Array([16000]);
const THRESHOLD = 0.5;
const SPEECH_PAD_MS = 300; // ms of silence before declaring speech_end
const MIN_SPEECH_MS = 250; // minimum speech duration to trigger

let isSpeaking = false;
let silenceFrames = 0;
let speechFrames = 0;
const FRAME_MS = 32; // each 512-sample chunk = 32ms at 16kHz
const PAD_FRAMES = Math.ceil(SPEECH_PAD_MS / FRAME_MS);
const MIN_FRAMES = Math.ceil(MIN_SPEECH_MS / FRAME_MS);

function resetState() {
    h = new ort.Tensor("float32", new Float32Array(128), [2, 1, 64]);
    c = new ort.Tensor("float32", new Float32Array(128), [2, 1, 64]);
    isSpeaking = false;
    silenceFrames = 0;
    speechFrames = 0;
}

self.onmessage = async (e) => {
    const msg = e.data;

    if (msg.type === "init") {
        try {
            ort.env.wasm.numThreads = 1;
            session = await ort.InferenceSession.create(msg.modelUrl, {
                executionProviders: ["wasm"],
            });
            resetState();
            self.postMessage({ type: "ready" });
        } catch (err) {
            self.postMessage({ type: "error", message: err.message });
        }
        return;
    }

    if (msg.type === "reset") {
        resetState();
        return;
    }

    if (msg.type === "audio" && session) {
        try {
            const inputTensor = new ort.Tensor("float32", new Float32Array(msg.data), [1, 512]);
            const srTensor = new ort.Tensor("int64", SR, []);

            const results = await session.run({ input: inputTensor, sr: srTensor, h, c });

            h = results.hn;
            c = results.cn;
            const score = results.output.data[0];

            // Post score for visualization
            self.postMessage({ type: "vad_score", score });

            if (score >= THRESHOLD) {
                speechFrames++;
                silenceFrames = 0;
                if (!isSpeaking && speechFrames >= MIN_FRAMES) {
                    isSpeaking = true;
                    self.postMessage({ type: "speech_start" });
                }
            } else {
                if (isSpeaking) {
                    silenceFrames++;
                    if (silenceFrames >= PAD_FRAMES) {
                        isSpeaking = false;
                        speechFrames = 0;
                        self.postMessage({ type: "speech_end" });
                    }
                } else {
                    speechFrames = 0;
                }
            }
        } catch (err) {
            self.postMessage({ type: "error", message: err.message });
        }
    }
};
