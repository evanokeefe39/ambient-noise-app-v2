/**
 * Brown (Brownian) Noise AudioWorklet Processor
 * Brownian integration (random walk) — produces -6 dB/octave spectral density.
 * Output clamped to [-1, 1].
 * Registered as 'brown-noise-processor'.
 */
class BrownNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._active = true
    // Per-channel last output value for integration
    this._lastOut = [0, 0]
    this.port.onmessage = (event) => {
      if (event.data === 'stop') this._active = false
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    for (let channel = 0; channel < output.length; channel++) {
      const channelData = output[channel]
      let lastOut = this._lastOut[channel] ?? 0
      for (let i = 0; i < channelData.length; i++) {
        const white = Math.random() * 2 - 1
        // Leaky integrator: accumulate with slight leak to prevent DC buildup
        lastOut = (lastOut + 0.02 * white) / 1.02
        // Scale up and clamp
        const sample = Math.max(-1, Math.min(1, lastOut * 3.5))
        channelData[i] = sample
      }
      this._lastOut[channel] = lastOut
    }
    return this._active
  }
}

registerProcessor('brown-noise-processor', BrownNoiseProcessor)
