import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

const COIN_FRAME_MARKER = 'retro-kart-coin-frame-'
const BACKGROUND_TOLERANCE = 70
const TRACK_COIN_SIZE_MULTIPLIER = 3

let installed = false

export function installItemVisualFixes() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    createStandaloneFrame: (
      textureKey: string,
      frameName: string,
      outputKey: string,
    ) => string | undefined
    updateWorldItemVisual: (item: unknown, camera: unknown) => void
  }

  const originalCreateStandaloneFrame = prototype.createStandaloneFrame
  prototype.createStandaloneFrame = function (
    this: ItemSystem,
    textureKey: string,
    frameName: string,
    outputKey: string,
  ) {
    const result = originalCreateStandaloneFrame.call(this, textureKey, frameName, outputKey)
    if (!result || !outputKey.includes(COIN_FRAME_MARKER)) return result

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

    for (let offset = 0; offset < pixels.length; offset += 4) {
      const r = pixels[offset]
      const g = pixels[offset + 1]
      const b = pixels[offset + 2]
      const matchesBackground = backgrounds.some(
        (background) =>
          Math.abs(r - background.r) +
            Math.abs(g - background.g) +
            Math.abs(b - background.b) <=
          BACKGROUND_TOLERANCE,
      )
      if (matchesBackground) pixels[offset + 3] = 0
    }

    context.clearRect(0, 0, source.width, source.height)
    context.putImageData(imageData, 0, 0)
    const canvasTexture = texture as Phaser.Textures.CanvasTexture
    canvasTexture.refresh()
    return result
  }

  const originalUpdateWorldItemVisual = prototype.updateWorldItemVisual
  prototype.updateWorldItemVisual = function (
    this: ItemSystem,
    itemValue: unknown,
    cameraValue: unknown,
  ) {
    originalUpdateWorldItemVisual.call(this, itemValue, cameraValue)

    const item = itemValue as {
      kind: string
      id: number
      x: number
      y: number
      image: Phaser.GameObjects.Image
    }
    if (item.kind !== 'coin' || !item.image.visible) return

    const system = this as unknown as {
      scene: Phaser.Scene
      renderer: {
        projectWorldPoint: (
          x: number,
          y: number,
          camera: unknown,
        ) => { x: number; y: number; screenY: number } | undefined
      }
    }
    const projected = system.renderer.projectWorldPoint(item.x, item.y, cameraValue)
    if (!projected) return

    const viewportHeight = Math.max(1, system.scene.scale.height)
    const horizonY = viewportHeight * 0.28
    const nearY = viewportHeight * 0.92
    const depth = Phaser.Math.Clamp(
      (projected.screenY - horizonY) / Math.max(1, nearY - horizonY),
      0,
      1,
    )
    const easedDepth = Phaser.Math.Easing.Quadratic.In(depth)
    const size = Phaser.Math.Linear(11, 36, easedDepth) * TRACK_COIN_SIZE_MULTIPLIER
    const bob = Math.sin(system.scene.time.now * 0.01 + item.id) * 2

    item.image
      .setDisplaySize(size, size)
      .setPosition(projected.x, projected.y - size * 0.38 + bob)
  }
}
