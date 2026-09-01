import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

const BANANA_WORLD_FRAME = 'retro-kart-banana-world-frame'
const BACKGROUND_TOLERANCE = 90

let installed = false

export function installBananaTransparency() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    createStandaloneFrame: (
      textureKey: string,
      frameName: string,
      outputKey: string,
    ) => string | undefined
  }

  const originalCreateStandaloneFrame = prototype.createStandaloneFrame
  prototype.createStandaloneFrame = function (
    this: ItemSystem,
    textureKey: string,
    frameName: string,
    outputKey: string,
  ) {
    const result = originalCreateStandaloneFrame.call(this, textureKey, frameName, outputKey)
    if (!result || outputKey !== BANANA_WORLD_FRAME) return result

    const system = this as unknown as { scene: Phaser.Scene }
    const texture = system.scene.textures.get(outputKey)
    const source = texture.getSourceImage() as HTMLCanvasElement
    const context = source.getContext('2d', { willReadFrequently: true })
    if (!context) return result

    const imageData = context.getImageData(0, 0, source.width, source.height)
    const pixels = imageData.data
    const cornerOffsets = [
      0,
      (source.width - 1) * 4,
      ((source.height - 1) * source.width) * 4,
      ((source.height * source.width) - 1) * 4,
    ]
    const backgrounds = cornerOffsets.map((offset) => ({
      r: pixels[offset],
      g: pixels[offset + 1],
      b: pixels[offset + 2],
    }))

    // Remove only pixels connected to the image edges. This strips the JPG's
    // yellow matte without punching transparent holes into the banana itself.
    const visited = new Uint8Array(source.width * source.height)
    const queue: number[] = []
    const enqueue = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) return
      const pixelIndex = y * source.width + x
      if (visited[pixelIndex]) return
      const offset = pixelIndex * 4
      const r = pixels[offset]
      const g = pixels[offset + 1]
      const b = pixels[offset + 2]
      const isBackground = backgrounds.some(
        (background) =>
          Math.abs(r - background.r) +
            Math.abs(g - background.g) +
            Math.abs(b - background.b) <=
          BACKGROUND_TOLERANCE,
      )
      if (!isBackground) return
      visited[pixelIndex] = 1
      queue.push(pixelIndex)
    }

    for (let x = 0; x < source.width; x += 1) {
      enqueue(x, 0)
      enqueue(x, source.height - 1)
    }
    for (let y = 0; y < source.height; y += 1) {
      enqueue(0, y)
      enqueue(source.width - 1, y)
    }

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const pixelIndex = queue[cursor]
      pixels[pixelIndex * 4 + 3] = 0
      const x = pixelIndex % source.width
      const y = Math.floor(pixelIndex / source.width)
      enqueue(x + 1, y)
      enqueue(x - 1, y)
      enqueue(x, y + 1)
      enqueue(x, y - 1)
    }

    context.clearRect(0, 0, source.width, source.height)
    context.putImageData(imageData, 0, 0)
    ;(texture as Phaser.Textures.CanvasTexture).refresh()
    return result
  }
}
