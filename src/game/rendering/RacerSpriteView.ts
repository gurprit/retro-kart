import Phaser from 'phaser'

type SpriteBounds = {
  x: number
  y: number
  width: number
  height: number
}

export class RacerSpriteView {
  private readonly scene: Phaser.Scene
  private readonly textureKey: string
  private readonly sprite: Phaser.GameObjects.Image
  private readonly frames: SpriteBounds[]
  private baseFrameIndex = 0

  constructor(
    scene: Phaser.Scene,
    textureKey: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.textureKey = textureKey
    this.frames = this.detectFrames()

    this.sprite = scene.add
      .image(x, y, textureKey)
      .setOrigin(0.5, 1)
      .setDepth(20)

    this.baseFrameIndex = this.findInitialFrameIndex()

    if (this.frames.length === 0) {
      this.sprite
        .setDisplaySize(220, 160)
        .setAlpha(0.9)
    } else {
      this.applyFrame(this.baseFrameIndex)
    }
  }

  get frameCount() {
    return this.frames.length
  }

  get currentFrameIndex() {
    return this.baseFrameIndex
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

  private detectFrames() {
    const sourceTexture = this.scene.textures.get(this.textureKey)
    const sourceImage = sourceTexture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }

    const canvas = document.createElement('canvas')
    canvas.width = sourceImage.width
    canvas.height = sourceImage.height

    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      return []
    }

    context.drawImage(sourceImage, 0, 0)

    const pixels = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    ).data

    const background = {
      r: pixels[0],
      g: pixels[1],
      b: pixels[2],
      a: pixels[3],
    }

    const isOccupied = (x: number, y: number) => {
      const index = (y * canvas.width + x) * 4
      const alpha = pixels[index + 3]

      if (alpha <= 16) {
        return false
      }

      const colourDistance =
        Math.abs(pixels[index] - background.r) +
        Math.abs(pixels[index + 1] - background.g) +
        Math.abs(pixels[index + 2] - background.b) +
        Math.abs(alpha - background.a)

      return colourDistance > 24
    }

    const occupiedRows = new Array<boolean>(canvas.height).fill(false)

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (isOccupied(x, y)) {
          occupiedRows[y] = true
          break
        }
      }
    }

    const rowBands: Array<{ start: number; end: number }> = []
    let bandStart = -1

    for (let y = 0; y <= canvas.height; y += 1) {
      const occupied = y < canvas.height && occupiedRows[y]

      if (occupied && bandStart === -1) {
        bandStart = y
      } else if (!occupied && bandStart !== -1) {
        rowBands.push({ start: bandStart, end: y - 1 })
        bandStart = -1
      }
    }

    const frames: SpriteBounds[] = []

    for (const band of rowBands) {
      const occupiedColumns = new Array<boolean>(canvas.width).fill(false)

      for (let x = 0; x < canvas.width; x += 1) {
        for (let y = band.start; y <= band.end; y += 1) {
          if (isOccupied(x, y)) {
            occupiedColumns[x] = true
            break
          }
        }
      }

      let columnStart = -1

      for (let x = 0; x <= canvas.width; x += 1) {
        const occupied = x < canvas.width && occupiedColumns[x]

        if (occupied && columnStart === -1) {
          columnStart = x
        } else if (!occupied && columnStart !== -1) {
          const width = x - columnStart
          const height = band.end - band.start + 1

          if (width >= 12 && height >= 12 && width <= 100 && height <= 100) {
            frames.push({
              x: columnStart,
              y: band.start,
              width,
              height,
            })
          }

          columnStart = -1
        }
      }
    }

    return frames
  }

  private findInitialFrameIndex() {
    if (this.frames.length === 0) {
      return 0
    }

    let bestIndex = 0
    let bestScore = Number.POSITIVE_INFINITY

    for (let index = 0; index < this.frames.length; index += 1) {
      const frame = this.frames[index]
      const aspectScore = Math.abs(frame.width / frame.height - 0.9)
      const sizeScore = Math.abs(frame.height - 40) / 40
      const score = aspectScore + sizeScore

      if (score < bestScore) {
        bestScore = score
        bestIndex = index
      }
    }

    return bestIndex
  }

  private applyFrame(index: number) {
    const frame = this.frames[index]

    if (!frame) {
      return
    }

    this.sprite.setVisible(true)
    this.sprite.setCrop(frame.x, frame.y, frame.width, frame.height)

    const targetHeight = 96
    const sourceTexture = this.scene.textures.get(this.textureKey)
    const sourceImage = sourceTexture.getSourceImage() as { width: number; height: number }
    const scale = targetHeight / frame.height

    this.sprite.setScale(scale)
    this.sprite.setDisplayOrigin(sourceImage.width / 2, sourceImage.height)
  }
}
