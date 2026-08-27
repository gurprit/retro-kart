import Phaser from 'phaser'

const CELL_WIDTH = 32
const CELL_HEIGHT = 32
const COLUMNS = 11
const TARGET_HEIGHT = 82
const BACKGROUND_TOLERANCE = 36
const NEUTRAL_SOURCE_INDEX = 11
const STEER_LEAN = 0.06
const STEER_SHIFT = 8

export class RacerSpriteView {
  private readonly scene: Phaser.Scene
  private readonly sprite: Phaser.GameObjects.Image
  private readonly baseX: number
  private readonly neutralTextureKey: string

  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.baseX = x
    this.neutralTextureKey = this.createNeutralFrame(textureKey)

    this.sprite = scene.add
      .image(x, y, this.neutralTextureKey)
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setDisplaySize(TARGET_HEIGHT, TARGET_HEIGHT)
  }

  update(steerDirection: number, deltaSeconds: number) {
    void deltaSeconds

    const clampedSteer = Phaser.Math.Clamp(steerDirection, -1, 1)

    this.sprite
      .setTexture(this.neutralTextureKey)
      .setFlipX(false)
      .setRotation(clampedSteer * STEER_LEAN)
      .setX(this.baseX + clampedSteer * STEER_SHIFT)
  }

  private createNeutralFrame(textureKey: string) {
    const sourceTexture = this.scene.textures.get(textureKey)
    const sourceImage = sourceTexture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }

    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = sourceImage.width
    sourceCanvas.height = sourceImage.height

    const sourceContext = sourceCanvas.getContext('2d', {
      willReadFrequently: true,
    })

    if (!sourceContext) {
      return textureKey
    }

    sourceContext.imageSmoothingEnabled = false
    sourceContext.drawImage(sourceImage, 0, 0)

    const column = NEUTRAL_SOURCE_INDEX % COLUMNS
    const row = Math.floor(NEUTRAL_SOURCE_INDEX / COLUMNS)
    const x = column * CELL_WIDTH
    const y = row * CELL_HEIGHT

    const imageData = sourceContext.getImageData(
      x,
      y,
      CELL_WIDTH,
      CELL_HEIGHT,
    )

    const cleaned = this.removeCellBackground(imageData)
    const frameTextureKey = 'prototype-racer-neutral'
    const frameTexture = this.scene.textures.createCanvas(
      frameTextureKey,
      CELL_WIDTH,
      CELL_HEIGHT,
    )

    if (!frameTexture) {
      return textureKey
    }

    frameTexture.context.imageSmoothingEnabled = false
    frameTexture.context.putImageData(cleaned, 0, 0)
    frameTexture.refresh()

    return frameTextureKey
  }

  private removeCellBackground(imageData: ImageData) {
    const pixels = imageData.data
    const colourCounts = new Map<string, number>()

    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 0) {
        continue
      }

      const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`
      colourCounts.set(key, (colourCounts.get(key) ?? 0) + 1)
    }

    let background = { r: 0, g: 0, b: 0 }
    let largestCount = 0

    for (const [key, count] of colourCounts) {
      if (count <= largestCount) {
        continue
      }

      largestCount = count
      const [r, g, b] = key.split(',').map(Number)
      background = { r, g, b }
    }

    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 0) {
        continue
      }

      const distance =
        Math.abs(pixels[index] - background.r) +
        Math.abs(pixels[index + 1] - background.g) +
        Math.abs(pixels[index + 2] - background.b)

      if (distance <= BACKGROUND_TOLERANCE) {
        pixels[index + 3] = 0
      }
    }

    return imageData
  }
}
