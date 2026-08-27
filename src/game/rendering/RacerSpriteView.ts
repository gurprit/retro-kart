import Phaser from 'phaser'

type SpriteFrame = {
  textureKey: string
  sourceIndex: number
}

const CELL_WIDTH = 32
const CELL_HEIGHT = 32
const COLUMNS = 11
const ROWS = 5
const TARGET_HEIGHT = 96
const BACKGROUND_TOLERANCE = 36
const MIN_FOREGROUND_PIXELS = 28

export class RacerSpriteView {
  private readonly scene: Phaser.Scene
  private readonly sprite: Phaser.GameObjects.Image
  private readonly frames: SpriteFrame[]
  private baseFrameIndex = 0

  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.frames = this.createPrototypeFrames(textureKey)

    const initialTextureKey = this.frames[0]?.textureKey ?? textureKey

    this.sprite = scene.add
      .image(x, y, initialTextureKey)
      .setOrigin(0.5, 1)
      .setDepth(20)

    this.applyFrame(this.baseFrameIndex)
  }

  get frameCount() {
    return this.frames.length
  }

  get currentFrameIndex() {
    return this.baseFrameIndex
  }

  get currentSourceIndex() {
    return this.frames[this.baseFrameIndex]?.sourceIndex ?? -1
  }

  cycleFrame(direction: number) {
    if (this.frames.length === 0) {
      return
    }

    this.baseFrameIndex = Phaser.Math.Wrap(
      this.baseFrameIndex + direction,
      0,
      this.frames.length,
    )

    this.applyFrame(this.baseFrameIndex)
  }

  update(steerDirection: number) {
    if (this.frames.length === 0) {
      return
    }

    const offset = steerDirection < 0 ? -1 : steerDirection > 0 ? 1 : 0
    const frameIndex = Phaser.Math.Wrap(
      this.baseFrameIndex + offset,
      0,
      this.frames.length,
    )

    this.applyFrame(frameIndex)
  }

  private createPrototypeFrames(textureKey: string) {
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
      return []
    }

    sourceContext.imageSmoothingEnabled = false
    sourceContext.drawImage(sourceImage, 0, 0)

    const frames: SpriteFrame[] = []

    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const sourceIndex = row * COLUMNS + column
        const x = column * CELL_WIDTH
        const y = row * CELL_HEIGHT

        if (
          x + CELL_WIDTH > sourceCanvas.width ||
          y + CELL_HEIGHT > sourceCanvas.height
        ) {
          continue
        }

        const imageData = sourceContext.getImageData(
          x,
          y,
          CELL_WIDTH,
          CELL_HEIGHT,
        )

        const cleaned = this.removeCellBackground(imageData)

        if (cleaned.foregroundPixels < MIN_FOREGROUND_PIXELS) {
          continue
        }

        const frameTextureKey = `prototype-racer-frame-${sourceIndex}`
        const frameTexture = this.scene.textures.createCanvas(
          frameTextureKey,
          CELL_WIDTH,
          CELL_HEIGHT,
        )

        if (!frameTexture) {
          continue
        }

        frameTexture.context.imageSmoothingEnabled = false
        frameTexture.context.putImageData(cleaned.imageData, 0, 0)
        frameTexture.refresh()

        frames.push({
          textureKey: frameTextureKey,
          sourceIndex,
        })
      }
    }

    return frames
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

    let foregroundPixels = 0

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
      } else {
        foregroundPixels += 1
      }
    }

    return { imageData, foregroundPixels }
  }

  private applyFrame(index: number) {
    const frame = this.frames[index]

    if (!frame) {
      this.sprite.setVisible(false)
      return
    }

    this.sprite
      .setVisible(true)
      .setTexture(frame.textureKey)
      .setDisplaySize(TARGET_HEIGHT, TARGET_HEIGHT)
  }
}
