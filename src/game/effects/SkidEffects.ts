import Phaser from 'phaser'

type ParticleFrame = {
  textureKey: string
  pixelCount: number
  saturation: number
  brightness: number
  warmScore: number
}

const CELL_SIZE = 16
const EMIT_INTERVAL = 0.055
const PARTICLE_LIFETIME = 0.34
const BACKGROUND_TOLERANCE = 32
const MIN_VISIBLE_PIXELS = 5
const MAX_VISIBLE_PIXELS = 180

export class SkidEffects {
  private readonly scene: Phaser.Scene
  private readonly x: number
  private readonly y: number
  private readonly dustFrames: string[] = []
  private readonly sparkFrames: string[] = []
  private emitTimer = 0

  constructor(
    scene: Phaser.Scene,
    particleTextureKey: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.x = x
    this.y = y
    this.extractParticleGrid(particleTextureKey)
  }

  update(active: boolean, speedRatio: number, deltaSeconds: number) {
    if (!active) {
      this.emitTimer = 0
      return
    }

    this.emitTimer -= deltaSeconds

    if (this.emitTimer > 0) {
      return
    }

    const intensity = Phaser.Math.Clamp(Math.abs(speedRatio), 0.2, 1)
    this.emitTimer = EMIT_INTERVAL * Phaser.Math.Linear(1.15, 0.72, intensity)

    this.spawnDust(-22, intensity)
    this.spawnDust(22, intensity)

    if (intensity > 0.72 && this.sparkFrames.length > 0) {
      this.spawnSpark(intensity)
    }
  }

  private spawnDust(offsetX: number, intensity: number) {
    const textureKey = Phaser.Utils.Array.GetRandom(this.dustFrames)

    if (!textureKey) {
      return
    }

    const particle = this.scene.add
      .image(this.x + offsetX, this.y + 2, textureKey)
      .setOrigin(0.5)
      .setDepth(19)
      .setAlpha(0.9)
      .setScale(Phaser.Math.Linear(1.35, 2.05, intensity))

    this.scene.tweens.add({
      targets: particle,
      x: particle.x + Phaser.Math.Between(-12, 12),
      y: particle.y + Phaser.Math.Between(9, 18),
      alpha: 0,
      scaleX: particle.scaleX * 1.45,
      scaleY: particle.scaleY * 1.45,
      duration: PARTICLE_LIFETIME * 1000,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    })
  }

  private spawnSpark(intensity: number) {
    const textureKey = Phaser.Utils.Array.GetRandom(this.sparkFrames)

    if (!textureKey) {
      return
    }

    const side = Phaser.Math.Between(0, 1) === 0 ? -1 : 1
    const particle = this.scene.add
      .image(this.x + side * 27, this.y - 1, textureKey)
      .setOrigin(0.5)
      .setDepth(21)
      .setAlpha(1)
      .setScale(Phaser.Math.Linear(1.05, 1.55, intensity))

    this.scene.tweens.add({
      targets: particle,
      x: particle.x + side * Phaser.Math.Between(5, 13),
      y: particle.y + Phaser.Math.Between(4, 11),
      alpha: 0,
      scaleX: particle.scaleX * 0.7,
      scaleY: particle.scaleY * 0.7,
      duration: 145,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    })
  }

  private extractParticleGrid(textureKey: string) {
    const texture = this.scene.textures.get(textureKey)
    const sourceImage = texture.getSourceImage() as CanvasImageSource & {
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

    const frames: ParticleFrame[] = []
    const columns = Math.floor(canvas.width / CELL_SIZE)
    const rows = Math.floor(canvas.height / CELL_SIZE)

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const sourceX = column * CELL_SIZE
        const sourceY = row * CELL_SIZE
        const imageData = context.getImageData(
          sourceX,
          sourceY,
          CELL_SIZE,
          CELL_SIZE,
        )

        const frame = this.createParticleFrame(
          imageData,
          row * columns + column,
        )

        if (frame) {
          frames.push(frame)
        }
      }
    }

    const dust = frames
      .filter(
        (frame) =>
          frame.saturation < 82 &&
          frame.brightness > 55 &&
          frame.brightness < 225,
      )
      .sort((a, b) => b.pixelCount - a.pixelCount)
      .slice(0, 10)

    const sparks = frames
      .filter(
        (frame) =>
          frame.warmScore > 30 &&
          frame.saturation > 65 &&
          frame.brightness > 80,
      )
      .sort((a, b) => b.warmScore - a.warmScore)
      .slice(0, 8)

    this.dustFrames.push(...dust.map((frame) => frame.textureKey))
    this.sparkFrames.push(...sparks.map((frame) => frame.textureKey))

    // Keep a conservative fallback so effects never disappear entirely if the
    // temporary prototype sheet has an unexpected palette.
    if (this.dustFrames.length === 0) {
      this.dustFrames.push(
        ...frames
          .filter((frame) => frame.saturation < 110)
          .slice(0, 6)
          .map((frame) => frame.textureKey),
      )
    }
  }

  private createParticleFrame(
    imageData: ImageData,
    sourceIndex: number,
  ): ParticleFrame | undefined {
    const pixels = imageData.data
    const background = this.findCellBackground(pixels)
    const cleaned = new ImageData(CELL_SIZE, CELL_SIZE)

    let pixelCount = 0
    let totalR = 0
    let totalG = 0
    let totalB = 0

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3]

      if (alpha <= 16) {
        continue
      }

      const r = pixels[index]
      const g = pixels[index + 1]
      const b = pixels[index + 2]
      const distance =
        Math.abs(r - background.r) +
        Math.abs(g - background.g) +
        Math.abs(b - background.b)

      if (distance <= BACKGROUND_TOLERANCE) {
        continue
      }

      cleaned.data[index] = r
      cleaned.data[index + 1] = g
      cleaned.data[index + 2] = b
      cleaned.data[index + 3] = 255

      pixelCount += 1
      totalR += r
      totalG += g
      totalB += b
    }

    if (
      pixelCount < MIN_VISIBLE_PIXELS ||
      pixelCount > MAX_VISIBLE_PIXELS
    ) {
      return undefined
    }

    const textureKey = `prototype-particle-cell-${sourceIndex}`

    if (!this.scene.textures.exists(textureKey)) {
      const frameTexture = this.scene.textures.createCanvas(
        textureKey,
        CELL_SIZE,
        CELL_SIZE,
      )

      if (!frameTexture) {
        return undefined
      }

      frameTexture.context.imageSmoothingEnabled = false
      frameTexture.context.putImageData(cleaned, 0, 0)
      frameTexture.refresh()
    }

    const avgR = totalR / pixelCount
    const avgG = totalG / pixelCount
    const avgB = totalB / pixelCount
    const max = Math.max(avgR, avgG, avgB)
    const min = Math.min(avgR, avgG, avgB)

    return {
      textureKey,
      pixelCount,
      saturation: max - min,
      brightness: (avgR + avgG + avgB) / 3,
      warmScore: avgR - (avgG + avgB) * 0.5,
    }
  }

  private findCellBackground(pixels: Uint8ClampedArray) {
    const counts = new Map<string, number>()

    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] <= 16) {
        continue
      }

      const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    let background = { r: 0, g: 0, b: 0 }
    let largestCount = 0

    for (const [key, count] of counts) {
      if (count <= largestCount) {
        continue
      }

      largestCount = count
      const [r, g, b] = key.split(',').map(Number)
      background = { r, g, b }
    }

    return background
  }
}
