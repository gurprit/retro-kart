import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

const GREEN_SHELL_FRAME_MARKER = 'retro-kart-greenShell-frame-'
let installed = false

export function installGreenShellTransparency() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    createStandaloneFrame: (
      textureKey: string,
      frameName: string,
      outputKey: string,
      chromaKeyBackground?: boolean,
    ) => string | undefined
  }

  const original = prototype.createStandaloneFrame
  prototype.createStandaloneFrame = function (
    this: ItemSystem,
    textureKey: string,
    frameName: string,
    outputKey: string,
    chromaKeyBackground = false,
  ) {
    const result = original.call(
      this,
      textureKey,
      frameName,
      outputKey,
      chromaKeyBackground,
    )
    if (!result || !outputKey.includes(GREEN_SHELL_FRAME_MARKER)) return result

    const system = this as unknown as { scene: Phaser.Scene }
    const texture = system.scene.textures.get(outputKey)
    const source = texture.getSourceImage() as HTMLCanvasElement
    const context = source.getContext('2d', { willReadFrequently: true })
    if (!context) return result

    const imageData = context.getImageData(0, 0, source.width, source.height)
    const pixels = imageData.data

    // The source JPG has a flat yellow/gold matte. Remove yellow-dominant pixels
    // rather than relying only on the four corners, which leaves a visible box.
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const r = pixels[offset]
      const g = pixels[offset + 1]
      const b = pixels[offset + 2]
      const yellowDominant =
        r > 105 &&
        g > 78 &&
        b < 125 &&
        r > b * 1.18 &&
        g > b * 1.08 &&
        Math.abs(r - g) < 105

      if (yellowDominant) pixels[offset + 3] = 0
    }

    context.clearRect(0, 0, source.width, source.height)
    context.putImageData(imageData, 0, 0)
    ;(texture as Phaser.Textures.CanvasTexture).refresh()
    return result
  }
}
