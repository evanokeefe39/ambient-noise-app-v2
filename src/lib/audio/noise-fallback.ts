/**
 * W2.A4 — ScriptProcessorNode fallback for browsers without AudioWorklet support.
 * Creates a ScriptProcessorNode that generates noise matching the given color.
 */

export type NoiseColor = 'white' | 'pink' | 'brown'

interface PinkState {
  b0: number; b1: number; b2: number; b3: number; b4: number; b5: number; b6: number
}

function createPinkState(): PinkState {
  return { b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 }
}

/**
 * Feature-detect AudioWorklet support.
 */
export function supportsAudioWorklet(ctx: AudioContext): boolean {
  return typeof ctx.audioWorklet !== 'undefined'
}

/**
 * Create a ScriptProcessorNode fallback for noise generation.
 * @deprecated ScriptProcessorNode is deprecated but used as a fallback.
 */
export function createFallbackNoiseNode(
  ctx: AudioContext,
  color: NoiseColor,
  bufferSize = 4096,
): ScriptProcessorNode {
  const node = ctx.createScriptProcessor(bufferSize, 0, 2)
  const pinkState: [PinkState, PinkState] = [createPinkState(), createPinkState()]
  const brownLastOut: [number, number] = [0, 0]

  node.onaudioprocess = (event: AudioProcessingEvent) => {
    const output = event.outputBuffer
    for (let channel = 0; channel < output.numberOfChannels; channel++) {
      const channelData = output.getChannelData(channel)

      if (color === 'white') {
        for (let i = 0; i < channelData.length; i++) {
          channelData[i] = Math.random() * 2 - 1
        }
      } else if (color === 'pink') {
        const s = pinkState[channel as 0 | 1]
        for (let i = 0; i < channelData.length; i++) {
          const w = Math.random() * 2 - 1
          s.b0 = 0.99886 * s.b0 + w * 0.0555179
          s.b1 = 0.99332 * s.b1 + w * 0.0750759
          s.b2 = 0.96900 * s.b2 + w * 0.1538520
          s.b3 = 0.86650 * s.b3 + w * 0.3104856
          s.b4 = 0.55000 * s.b4 + w * 0.5329522
          s.b5 = -0.7616 * s.b5 - w * 0.0168980
          const pink = (s.b0 + s.b1 + s.b2 + s.b3 + s.b4 + s.b5 + s.b6 + w * 0.5362) / 6
          s.b6 = w * 0.115926
          channelData[i] = Math.max(-1, Math.min(1, pink))
        }
      } else {
        // brown
        let last = brownLastOut[channel as 0 | 1]
        for (let i = 0; i < channelData.length; i++) {
          const w = Math.random() * 2 - 1
          last = (last + 0.02 * w) / 1.02
          channelData[i] = Math.max(-1, Math.min(1, last * 3.5))
        }
        brownLastOut[channel as 0 | 1] = last
      }
    }
  }

  return node
}
