import Phaser from 'phaser'

type ParticleFrame = {
  textureKey: string
  saturation: number
  warmScore: number
  area: number
}

const CELL_SIZE = 16
const EMIT_INTERVAL = 0.055
const PARTICLE_LIFETIME = 0.34
const BACKGROUND_TOLERANCE = 34
const MIN_VISIBLE_PIXELS = 5

export class SkidEffects {
  private readonly scene: Phaser.Scene
  private readonly x: number
  private readonly y: number
  private readonly dustFrames: string[] = []
  private readonly sparkFrames: string[] = []
  private emitTimer = 0
  private ready = false

  constructor(
    scene: Phaser.Scene,
    particleSheetUrl: string,
    x: number,
    y: number,
  ) {
    this.scene = scene
    this.x = x
    this.y = y
    this.loadParticleSheet(particleSheetUrl)
  }

  update(active: boolean, speedRatio: number, deltaSeconds: number) {
    if (!active || !this.ready) {
      this.emitTimer = 0
      return
    }

    this.emitTimer -= deltaSeconds

    if (this.emitTimer > 0) {
      return
    }

    const intensity = Phaser.Math.Clamp(Math.abs(speedRatio), 0.2, 1)
    this.emitTimer = EMIT_INTERVAL * Phaser.Math.Linear(1.15, 0.7, intensity)

    this.spawnDust(-23, intensity)
    this.spawnDust(23, intensity)

    if (intensity > 0.68 && this.sparkFrames.length > 0) {
      this.spawnSpark(intensity)
    }
  }

  private loadParticleSheet(url: string) {
    const image = new Image()

    image.onload = () => {
      this.extractGridFrames(image)
      this.ready = this.dustFrames.length > 0
    }

    image.onerror = () => {
      console.warn(`Could not load particle sheet: ${url}`)
    }

    image.src = `${url}?v=2`
  }

  private spawnDust(offsetX: number, intensity: number) {
    const textureKey = Phaser.Utils.Array.GetRandom(this.dustFrames)

    if (!textureKey) {
      return
    }

    const particle = this.scene.add
      .image(this.x + offsetX, this.y + 3, textureKey)
      .setOrigin(0.5)
      .setDepth(19)
      .setAlpha(0.82)
      .setScale(Phaser.Math.Linear(1.2, 1.9, intensity))

    const driftX = Phaser.Math.Between(-12, 12)
    const driftY = Phaser.Math.Between(10, 20)

    this.scene.tweens.add({
      targets: particle,
      x: particle.x + driftX,
      y: particle.y + driftY,
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
      .setAlpha(0.95)
      .setScale(Phaser.Math.Linear(0.9, 1.3, intensity))

    this.scene.tweens.add({
      targets: particle,
      x: particle.x + side * Phaser.Math.Between(6, 14),
      y: particle.y + Phaser.Math.Between(5, 13),
      alpha: 0,
      scaleX: particle.scaleX * 0.7,
      scaleY: particle.scaleY * 0.7,
      duration: 150,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    })
  }

  private extractGridFrames(image: HTMLImageElement) {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight

    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      return
    }

    context.imageSmoothingEnabled = false
    context.drawImage(image, 0, 0)

    const columns = Math.floor(canvas.width / CELL_SIZE)
    const rows = Math.floor(canvas.height / CELL_SIZE)
    const frames: ParticleFrame[] = []

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const imageData = context.getImageData(
          column * CELL_SIZE,
          row * CELL_SIZE,
          CELL_SIZE,
          CELL_SIZE,
        )

        const frame = this.createFrameFromCell(imageData, row, column)

        if (frame) {
          frames.push(frame)
        }
      }
    }

    const dust = frames
      .filter((frame) => frame.saturation < 90 && frame.area >= 10)
      .sort((a, b) => b.area - a.area)
      .slice(0, 10)

    const sparks = frames
      .filter((frame) => frame.warmScore > 22 && frame.saturation > 55)
      .sort((a, b) => b.warmScore - a.warmScore)
      .slice(0, 8)

    this.dustFrames.push(...dust.map((frame) => frame.textureKey))
    this.sparkFrames.push(...sparks.map((frame) => frame.textureKey))

    if (this.dustFrames.length === 0) {
      this.dustFrames.push(...frames.slice(0, 8).map((frame) => frame.textureKey))
    }
  }

  private createFrameFromCell(
    imageData: ImageData,
    row: number,
    column: number,
  ): ParticleFrame | undefined {
    const pixels = imageData.data
    const background = this.findDominantColour(pixels)
    let visiblePixels = 0
    let totalR = 0
    let totalG = 0
    let totalB = 0

    const cleaned = new ImageData(CELL_SIZE, CELL_SIZE)

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3]

      if (alpha <= 16) {
        continue
      }

      const distance =
        Math.abs(pixels[index] - background.r) +
        Math.abs(pixels[index + 1] - background.g) +
        Math.abs(pixels[index + 2] - background.b)

      if (distance <= BACKGROUND_TOLERANCE) {
        continue
      }

      cleaned.data[index] = pixels[index]
      cleaned.data[index + 1] = pixels[index + 1]
      cleaned.data[index + 2] = pixels[index + 2]
      cleaned.data[index + 3] = 255

      visiblePixels += 1
      totalR += pixels[index]
      totalG += pixels[index + 1]
      totalB += pixels[index + 2]
    }

    if (visiblePixels < MIN_VISIBLE_PIXELS) {
      return undefined
    }

    const textureKey = `prototype-particle-${row}-${column}`

    if (!this.scene.textures.exists(textureKey)) {
      const texture = this.scene.textures.createCanvas(
        textureKey,
        CELL_SIZE,
        CELL_SIZE,
      )

      if (!texture) {
        return undefined
      }

      texture.context.imageSmoothingEnabled = false
      texture.context.putImageData(cleaned, 0, 0)
      texture.refresh()
    }

    const avgR = totalR / visiblePixels
    const avgG = totalG / visiblePixels
    const avgB = totalB / visiblePixels
    const saturation = Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB)
    const warmScore = avgR - (avgG + avgB) * 0.5

    return {
      textureKey,
      saturation,
      warmScore,
      area: visiblePixels,
    }
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
