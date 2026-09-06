/**
 * White Noise AudioWorklet Processor
 * Generates flat-spectrum white noise with uniform random samples in [-1, 1].
 * Registered as 'white-noise-processor'.
 */
class WhiteNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._active = true
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this._active = false
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    for (let channel = 0; channel < output.length; channel++) {
      const channelData = output[channel]
      for (let i = 0; i < channelData.length; i++) {
        // Uniform random in [-1, 1]
        channelData[i] = Math.random() * 2 - 1
      }
    }
    return this._active
  }
}

registerProcessor('white-noise-processor', WhiteNoiseProcessor)
