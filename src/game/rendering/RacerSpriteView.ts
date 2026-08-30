import Phaser from 'phaser'

type ExtractedFrame = {
  textureKey: string
  x: number
  y: number
  width: number
  height: number
}

const TARGET_HEIGHT = 82
const BACKGROUND_TOLERANCE = 38
const MIN_COMPONENT_AREA = 42
const MIN_FRAME_SIZE = 12
const MAX_FRAME_SIZE = 58
const ROW_TOLERANCE = 18

const TURN_FRAME_THRESHOLDS = {
  medium: 0.4,
  hard: 0.72,
} as const

const OFF_ROAD_BOUNCE_HEIGHT = 4
const OFF_ROAD_BOUNCE_BASE_RATE = 18
const OFF_ROAD_BOUNCE_SPEED_RATE = 18

const SPIN_FRAME_TIME = 0.055
const DEFAULT_SPIN_LOOPS = 2

export class RacerSpriteView {
  private readonly scene: Phaser.Scene
  private readonly sprite: Phaser.GameObjects.Image
  private readonly baseX: number
  private readonly baseY: number
  private readonly racingFrames: string[] = []
  private readonly spinFrames: string[] = []

  private bouncePhase = 0
  private spinTimer = 0
  private spinFrameTimer = 0
  private spinFrameIndex = 0

  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.baseX = x
    this.baseY = y
    this.extractRacerFrames(textureKey)

    const neutralTexture = this.racingFrames[0] ?? textureKey

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

    if (this.spinTimer > 0 && this.spinFrames.length > 0) {
      this.updateSpin(deltaSeconds)
    } else {
      this.updateDrivingFrame(clampedSteer, clampedSpeed, isPowersliding)
    }

    let bounceOffset = 0

    if (isOffRoad && clampedSpeed > 0.03 && this.spinTimer <= 0) {
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

  /**
   * Reusable hit reaction for barriers now and shells/items later.
   * Calling this again while already spinning restarts the animation.
   */
  triggerSpin(loops = DEFAULT_SPIN_LOOPS) {
    if (this.spinFrames.length < 2) {
      return
    }

    this.spinFrameIndex = 0
    this.spinFrameTimer = 0
    this.spinTimer = this.spinFrames.length * SPIN_FRAME_TIME * Math.max(1, loops)
  }

  get isSpinning() {
    return this.spinTimer > 0
  }

  private updateDrivingFrame(
    steerDirection: number,
    speedRatio: number,
    isPowersliding: boolean,
  ) {
    if (this.racingFrames.length === 0) {
      return
    }

    let frameIndex = 0

    if (steerDirection !== 0) {
      if (isPowersliding) {
        // Handbrake slides deliberately reach deeper into the turn sequence.
        frameIndex = Math.min(this.racingFrames.length - 1, 4)
      } else if (speedRatio >= TURN_FRAME_THRESHOLDS.hard) {
        frameIndex = Math.min(this.racingFrames.length - 1, 3)
      } else if (speedRatio >= TURN_FRAME_THRESHOLDS.medium) {
        frameIndex = Math.min(this.racingFrames.length - 1, 2)
      } else {
        frameIndex = Math.min(this.racingFrames.length - 1, 1)
      }
    }

    this.sprite
      .setVisible(true)
      .setTexture(this.racingFrames[frameIndex])
      .setFlipX(steerDirection < 0)
  }

  private updateSpin(deltaSeconds: number) {
    this.spinTimer = Math.max(0, this.spinTimer - deltaSeconds)
    this.spinFrameTimer -= deltaSeconds

    while (this.spinFrameTimer <= 0 && this.spinTimer > 0) {
      this.spinFrameTimer += SPIN_FRAME_TIME
      this.spinFrameIndex = (this.spinFrameIndex + 1) % this.spinFrames.length
    }

    const textureKey = this.spinFrames[this.spinFrameIndex]

    if (textureKey) {
      this.sprite
        .setVisible(true)
        .setTexture(textureKey)
        .setFlipX(false)
    }
  }

  private extractRacerFrames(textureKey: string) {
    const sourceTexture = this.scene.textures.get(textureKey)
    const sourceImage = sourceTexture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }

    const canvas = document.createElement('canvas')
    canvas.width = sourceImage.width
    canvas.height = sourceImage.height

    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      return
    }

    context.imageSmoothingEnabled = false
    context.drawImage(sourceImage, 0, 0)

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const background = this.findDominantColour(imageData.data)
    const occupied = this.createOccupiedMask(imageData.data, canvas.width, canvas.height, background)
    const components = this.findComponents(occupied, canvas.width, canvas.height)

    const candidateFrames = components
      .filter((component) => {
        const area = component.width * component.height

        return (
          area >= MIN_COMPONENT_AREA &&
          component.width >= MIN_FRAME_SIZE &&
          component.height >= MIN_FRAME_SIZE &&
          component.width <= MAX_FRAME_SIZE &&
          component.height <= MAX_FRAME_SIZE
        )
      })
      .sort((a, b) => a.y - b.y || a.x - b.x)

    if (candidateFrames.length === 0) {
      return
    }

    const rows: ExtractedFrame[][] = []

    for (const component of candidateFrames) {
      const centerY = component.y + component.height / 2
      let row = rows.find((candidateRow) => {
        const first = candidateRow[0]
        const rowCenterY = first.y + first.height / 2
        return Math.abs(rowCenterY - centerY) <= ROW_TOLERANCE
      })

      if (!row) {
        row = []
        rows.push(row)
      }

      const texture = this.createFrameTexture(
        context,
        component,
        background,
        `prototype-racer-auto-${rows.length}-${row.length}`,
      )

      if (texture) {
        row.push({ ...component, textureKey: texture })
      }
    }

    const racingRow = rows
      .filter((row) => row.length >= 4)
      .sort((a, b) => b.length - a.length || a[0].y - b[0].y)[0]

    const selected = racingRow ?? rows.sort((a, b) => b.length - a.length)[0]

    if (!selected) {
      return
    }

    selected.sort((a, b) => a.x - b.x)

    // The cleaned Mario sheet is arranged as a directional sequence from the
    // rear view through progressively stronger turns. Right turns are mirrored,
    // just as before, while the entire sequence is useful for hit/spin effects.
    this.racingFrames.push(...selected.map((frame) => frame.textureKey))
    this.spinFrames.push(...selected.map((frame) => frame.textureKey))
  }

  private createOccupiedMask(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    background: { r: number; g: number; b: number },
  ) {
    const mask = new Uint8Array(width * height)

    for (let index = 0; index < width * height; index += 1) {
      const pixelIndex = index * 4

      if (pixels[pixelIndex + 3] <= 16) {
        continue
      }

      const distance =
        Math.abs(pixels[pixelIndex] - background.r) +
        Math.abs(pixels[pixelIndex + 1] - background.g) +
        Math.abs(pixels[pixelIndex + 2] - background.b)

      if (distance > BACKGROUND_TOLERANCE) {
        mask[index] = 1
      }
    }

    // One-pixel dilation reconnects wheels/driver details that are separated by
    // a tiny background gap without joining neighbouring racer poses together.
    const dilated = mask.slice()

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x

        if (!mask[index]) {
          continue
        }

        dilated[index - 1] = 1
        dilated[index + 1] = 1
        dilated[index - width] = 1
        dilated[index + width] = 1
      }
    }

    return dilated
  }

  private findComponents(mask: Uint8Array, width: number, height: number) {
    const visited = new Uint8Array(mask.length)
    const components: Array<{ x: number; y: number; width: number; height: number }> = []

    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) {
        continue
      }

      const queue = [start]
      visited[start] = 1
      let cursor = 0
      let minX = width
      let minY = height
      let maxX = 0
      let maxY = 0
      let pixels = 0

      while (cursor < queue.length) {
        const index = queue[cursor++]
        const x = index % width
        const y = Math.floor(index / width)

        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        pixels += 1

        const neighbours = [index - 1, index + 1, index - width, index + width]

        for (const neighbour of neighbours) {
          if (neighbour < 0 || neighbour >= mask.length || visited[neighbour] || !mask[neighbour]) {
            continue
          }

          const nx = neighbour % width
          const ny = Math.floor(neighbour / width)

          if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) {
            continue
          }

          visited[neighbour] = 1
          queue.push(neighbour)
        }
      }

      if (pixels >= MIN_COMPONENT_AREA) {
        components.push({
          x: Math.max(0, minX - 1),
          y: Math.max(0, minY - 1),
          width: Math.min(width - minX, maxX - minX + 3),
          height: Math.min(height - minY, maxY - minY + 3),
        })
      }
    }

    return components
  }

  private createFrameTexture(
    context: CanvasRenderingContext2D,
    frame: { x: number; y: number; width: number; height: number },
    background: { r: number; g: number; b: number },
    textureKey: string,
  ) {
    const imageData = context.getImageData(frame.x, frame.y, frame.width, frame.height)
    const pixels = imageData.data

    for (let index = 0; index < pixels.length; index += 4) {
      const distance =
        Math.abs(pixels[index] - background.r) +
        Math.abs(pixels[index + 1] - background.g) +
        Math.abs(pixels[index + 2] - background.b)

      if (pixels[index + 3] <= 16 || distance <= BACKGROUND_TOLERANCE) {
        pixels[index + 3] = 0
      }
    }

    if (this.scene.textures.exists(textureKey)) {
      return textureKey
    }

    const texture = this.scene.textures.createCanvas(textureKey, frame.width, frame.height)

    if (!texture) {
      return undefined
    }

    texture.context.imageSmoothingEnabled = false
    texture.context.putImageData(imageData, 0, 0)
    texture.refresh()

    return textureKey
  }

  private findDominantColour(pixels: Uint8ClampedArray) {
    const counts = new Map<string, number>()

    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] <= 16) {
        continue
      }

      const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    let dominant = { r: 0, g: 0, b: 0 }
    let largestCount = 0

    for (const [key, count] of counts) {
      if (count <= largestCount) {
        continue
      }

      largestCount = count
      const [r, g, b] = key.split(',').map(Number)
      dominant = { r, g, b }
    }

    return dominant
  }
}
