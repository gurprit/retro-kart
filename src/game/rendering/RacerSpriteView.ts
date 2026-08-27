import Phaser from 'phaser'

const CELL_WIDTH = 32
const CELL_HEIGHT = 32
const COLUMNS = 11
const TARGET_HEIGHT = 82
const BACKGROUND_TOLERANCE = 36

const FRAME_SOURCES = {
  neutral: 11,
  slightTurn: 12,
  mediumTurn: 13,
  hardTurn: 14,
} as const

const TURN_FRAME_THRESHOLDS = {
  medium: 0.4,
  hard: 0.72,
} as const

const OFF_ROAD_BOUNCE_HEIGHT = 4
const OFF_ROAD_BOUNCE_BASE_RATE = 18
const OFF_ROAD_BOUNCE_SPEED_RATE = 18

export class RacerSpriteView {
  private readonly scene: Phaser.Scene
  private readonly sprite: Phaser.GameObjects.Image
  private readonly frames = new Map<number, string>()
  private readonly baseX: number
  private readonly baseY: number
  private bouncePhase = 0

  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.baseX = x
    this.baseY = y
    this.createMappedFrames(textureKey)

    const neutralTexture = this.frames.get(FRAME_SOURCES.neutral) ?? textureKey

    this.sprite = scene.add
      .image(x, y, neutralTexture)
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setDisplaySize(TARGET_HEIGHT, TARGET_HEIGHT)
  }

  update(
    steerDirection: number,
    speedRatio: number,
    isOffRoad: boolean,
    isPowersliding: boolean,
    deltaSeconds: number,
  ) {
    const clampedSteer = Phaser.Math.Clamp(steerDirection, -1, 1)
    const clampedSpeed = Phaser.Math.Clamp(Math.abs(speedRatio), 0, 1)

    let sourceIndex = FRAME_SOURCES.neutral

    if (clampedSteer !== 0) {
      if (isPowersliding || clampedSpeed >= TURN_FRAME_THRESHOLDS.hard) {
        sourceIndex = FRAME_SOURCES.hardTurn
      } else if (clampedSpeed >= TURN_FRAME_THRESHOLDS.medium) {
        sourceIndex = FRAME_SOURCES.mediumTurn
      } else {
        sourceIndex = FRAME_SOURCES.slightTurn
      }
    }

    const textureKey = this.frames.get(sourceIndex)

    if (textureKey) {
      this.sprite
        .setVisible(true)
        .setTexture(textureKey)
        .setFlipX(clampedSteer < 0)
    }

    let bounceOffset = 0

    if (isOffRoad && clampedSpeed > 0.03) {
      const bounceRate =
        OFF_ROAD_BOUNCE_BASE_RATE + OFF_ROAD_BOUNCE_SPEED_RATE * clampedSpeed

      this.bouncePhase += bounceRate * deltaSeconds
      bounceOffset =
        Math.abs(Math.sin(this.bouncePhase)) *
        OFF_ROAD_BOUNCE_HEIGHT *
        (0.45 + clampedSpeed * 0.55)
    } else {
      this.bouncePhase = 0
    }

    this.sprite
      .setX(this.baseX)
      .setY(this.baseY - bounceOffset)
      .setRotation(0)
      .setDisplaySize(TARGET_HEIGHT, TARGET_HEIGHT)
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

    const sourceIndices = [
      FRAME_SOURCES.neutral,
      FRAME_SOURCES.slightTurn,
      FRAME_SOURCES.mediumTurn,
      FRAME_SOURCES.hardTurn,
    ]

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

      if (this.scene.textures.exists(frameTextureKey)) {
        this.frames.set(sourceIndex, frameTextureKey)
        continue
      }

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
      this.frames.set(sourceIndex, frameTextureKey)
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
}
