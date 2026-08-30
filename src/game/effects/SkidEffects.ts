import Phaser from 'phaser'

type ExtractedFrame = {
  textureKey: string
  area: number
  warmScore: number
  saturation: number
}

const EMIT_INTERVAL = 0.055
const PARTICLE_LIFETIME = 0.34
const BACKGROUND_TOLERANCE = 28
const MIN_COMPONENT_PIXELS = 4
const MAX_COMPONENT_SIZE = 40

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
    this.extractParticleFrames(particleTextureKey)
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
    this.emitTimer = EMIT_INTERVAL * Phaser.Math.Linear(1.15, 0.7, intensity)

    this.spawnDust(-23, intensity)
    this.spawnDust(23, intensity)

    if (intensity > 0.68 && this.sparkFrames.length > 0) {
      this.spawnSpark(intensity)
    }
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
      .setAlpha(0.8)
      .setScale(Phaser.Math.Linear(1.15, 1.8, intensity))

    const driftX = Phaser.Math.Between(-12, 12)
    const driftY = Phaser.Math.Between(10, 20)

    this.scene.tweens.add({
      targets: particle,
      x: particle.x + driftX,
      y: particle.y + driftY,
      alpha: 0,
      scaleX: particle.scaleX * 1.55,
      scaleY: particle.scaleY * 1.55,
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
      .setScale(Phaser.Math.Linear(0.9, 1.35, intensity))

    this.scene.tweens.add({
      targets: particle,
      x: particle.x + side * Phaser.Math.Between(5, 14),
      y: particle.y + Phaser.Math.Between(5, 13),
      alpha: 0,
      scaleX: particle.scaleX * 0.65,
      scaleY: particle.scaleY * 0.65,
      duration: 150,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    })
  }

  private extractParticleFrames(textureKey: string) {
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

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = imageData.data
    const background = this.findDominantColour(pixels)
    const occupied = new Uint8Array(canvas.width * canvas.height)

    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const pixelIndex = (y * canvas.width + x) * 4
        const distance =
          Math.abs(pixels[pixelIndex] - background.r) +
          Math.abs(pixels[pixelIndex + 1] - background.g) +
          Math.abs(pixels[pixelIndex + 2] - background.b)

        if (pixels[pixelIndex + 3] > 16 && distance > BACKGROUND_TOLERANCE) {
          occupied[y * canvas.width + x] = 1
        }
      }
    }

    const visited = new Uint8Array(occupied.length)
    const frames: ExtractedFrame[] = []

    for (let start = 0; start < occupied.length; start += 1) {
      if (!occupied[start] || visited[start]) {
        continue
      }

      const queue = [start]
      visited[start] = 1
      let cursor = 0
      let minX = canvas.width
      let minY = canvas.height
      let maxX = 0
      let maxY = 0
      let count = 0
      let totalR = 0
      let totalG = 0
      let totalB = 0

      while (cursor < queue.length) {
        const index = queue[cursor]
        cursor += 1
        const x = index % canvas.width
        const y = Math.floor(index / canvas.width)
        const pixelIndex = index * 4

        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
        count += 1
        totalR += pixels[pixelIndex]
        totalG += pixels[pixelIndex + 1]
        totalB += pixels[pixelIndex + 2]

        const neighbours = [index - 1, index + 1, index - canvas.width, index + canvas.width]

        for (const neighbour of neighbours) {
          if (neighbour < 0 || neighbour >= occupied.length || visited[neighbour]) {
            continue
          }

          const nx = neighbour % canvas.width
          const ny = Math.floor(neighbour / canvas.width)

          if (Math.abs(nx - x) + Math.abs(ny - y) !== 1 || !occupied[neighbour]) {
            continue
          }

          visited[neighbour] = 1
          queue.push(neighbour)
        }
      }

      const width = maxX - minX + 1
      const height = maxY - minY + 1

      if (
        count < MIN_COMPONENT_PIXELS ||
        width > MAX_COMPONENT_SIZE ||
        height > MAX_COMPONENT_SIZE
      ) {
        continue
      }

      const frameKey = `prototype-particle-${frames.length}`
      const frameTexture = this.scene.textures.createCanvas(frameKey, width, height)

      if (!frameTexture) {
        continue
      }

      const frameData = frameTexture.context.createImageData(width, height)

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const sourceX = minX + x
          const sourceY = minY + y
          const sourceIndex = (sourceY * canvas.width + sourceX) * 4
          const targetIndex = (y * width + x) * 4
          const distance =
            Math.abs(pixels[sourceIndex] - background.r) +
            Math.abs(pixels[sourceIndex + 1] - background.g) +
            Math.abs(pixels[sourceIndex + 2] - background.b)

          if (pixels[sourceIndex + 3] <= 16 || distance <= BACKGROUND_TOLERANCE) {
            continue
          }

          frameData.data[targetIndex] = pixels[sourceIndex]
          frameData.data[targetIndex + 1] = pixels[sourceIndex + 1]
          frameData.data[targetIndex + 2] = pixels[sourceIndex + 2]
          frameData.data[targetIndex + 3] = 255
        }
      }

      frameTexture.context.imageSmoothingEnabled = false
      frameTexture.context.putImageData(frameData, 0, 0)
      frameTexture.refresh()

      const avgR = totalR / count
      const avgG = totalG / count
      const avgB = totalB / count
      const saturation = Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB)
      const warmScore = avgR - (avgG + avgB) * 0.5

      frames.push({
        textureKey: frameKey,
        area: count,
        warmScore,
        saturation,
      })
    }

    const dust = frames
      .filter((frame) => frame.saturation < 75)
      .sort((a, b) => b.area - a.area)
      .slice(0, 8)

    const sparks = frames
      .filter((frame) => frame.warmScore > 35 && frame.saturation > 65)
      .sort((a, b) => b.warmScore - a.warmScore)
      .slice(0, 6)

    this.dustFrames.push(...dust.map((frame) => frame.textureKey))
    this.sparkFrames.push(...sparks.map((frame) => frame.textureKey))

    if (this.dustFrames.length === 0) {
      this.dustFrames.push(...frames.slice(0, 6).map((frame) => frame.textureKey))
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
