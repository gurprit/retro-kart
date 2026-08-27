import Phaser from 'phaser'

type SpriteFrame = {
  textureKey: string
  sourceIndex: number
}

const CELL_WIDTH = 32
const CELL_HEIGHT = 32
const COLUMNS = 11
const TARGET_HEIGHT = 82
const BACKGROUND_TOLERANCE = 36
const STEER_RELEASE_DELAY = 0.08

const FRAME_SOURCES = {
  turn: 7,
  neutral: 11,
} as const

export class RacerSpriteView {
  private readonly scene: Phaser.Scene
  private readonly sprite: Phaser.GameObjects.Image
  private readonly frames = new Map<number, SpriteFrame>()
  private displayedSteerDirection = 0
  private steerReleaseTimer = 0

  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.createMappedFrames(textureKey)

    const neutral = this.frames.get(FRAME_SOURCES.neutral)

    this.sprite = scene.add
      .image(x, y, neutral?.textureKey ?? textureKey)
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setDisplaySize(TARGET_HEIGHT, TARGET_HEIGHT)
  }

  update(steerDirection: number, deltaSeconds: number) {
    if (steerDirection !== 0) {
      this.displayedSteerDirection = steerDirection
      this.steerReleaseTimer = STEER_RELEASE_DELAY
    } else if (this.steerReleaseTimer > 0) {
      this.steerReleaseTimer = Math.max(
        0,
        this.steerReleaseTimer - deltaSeconds,
      )
    } else {
      this.displayedSteerDirection = 0
    }

    if (this.displayedSteerDirection === 0) {
      this.applyFrame(FRAME_SOURCES.neutral, false)
      return
    }

    this.applyFrame(
      FRAME_SOURCES.turn,
      this.displayedSteerDirection > 0,
    )
  }

  private createMappedFrames(textureKey: string) {
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
      return
    }

    sourceContext.imageSmoothingEnabled = false
    sourceContext.drawImage(sourceImage, 0, 0)

    const sourceIndices = [FRAME_SOURCES.turn, FRAME_SOURCES.neutral]

    for (const sourceIndex of sourceIndices) {
      const column = sourceIndex % COLUMNS
      const row = Math.floor(sourceIndex / COLUMNS)
      const x = column * CELL_WIDTH
      const y = row * CELL_HEIGHT

      const imageData = sourceContext.getImageData(
        x,
        y,
        CELL_WIDTH,
        CELL_HEIGHT,
      )

      const cleaned = this.removeCellBackground(imageData)
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
      frameTexture.context.putImageData(cleaned, 0, 0)
      frameTexture.refresh()

      this.frames.set(sourceIndex, {
        textureKey: frameTextureKey,
        sourceIndex,
      })
    }
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

  private applyFrame(sourceIndex: number, flipX: boolean) {
    const frame = this.frames.get(sourceIndex)

    if (!frame) {
      this.sprite.setVisible(false)
      return
    }

    this.sprite
      .setVisible(true)
      .setTexture(frame.textureKey)
      .setFlipX(flipX)
      .setDisplaySize(TARGET_HEIGHT, TARGET_HEIGHT)
  }
}
