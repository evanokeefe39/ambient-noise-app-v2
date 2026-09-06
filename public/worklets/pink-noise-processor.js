/**
 * Pink Noise AudioWorklet Processor
 * Paul Kellet algorithm — produces -3 dB/octave spectral density.
 * Registered as 'pink-noise-processor'.
 */
class PinkNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._active = true
    // Per-channel filter state (support up to 2 channels)
    this._state = Array.from({ length: 2 }, () => ({
      b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0,
    }))
    this.port.onmessage = (event) => {
      if (event.data === 'stop') this._active = false
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    for (let channel = 0; channel < output.length; channel++) {
      const channelData = output[channel]
      const s = this._state[channel] ?? this._state[0]
      for (let i = 0; i < channelData.length; i++) {
        const white = Math.random() * 2 - 1

        // Paul Kellet's refined method
        s.b0 = 0.99886 * s.b0 + white * 0.0555179
        s.b1 = 0.99332 * s.b1 + white * 0.0750759
        s.b2 = 0.96900 * s.b2 + white * 0.1538520
        s.b3 = 0.86650 * s.b3 + white * 0.3104856
        s.b4 = 0.55000 * s.b4 + white * 0.5329522
        s.b5 = -0.7616 * s.b5 - white * 0.0168980
        const pink = (s.b0 + s.b1 + s.b2 + s.b3 + s.b4 + s.b5 + s.b6 + white * 0.5362) / 6
        s.b6 = white * 0.115926

        // Clamp to [-1, 1]
        channelData[i] = Math.max(-1, Math.min(1, pink))
      }
    }
    return this._active
  }
}

registerProcessor('pink-noise-processor', PinkNoiseProcessor)
