import Phaser from 'phaser'

export type TrackSurface = 'road' | 'offRoad' | 'barrier' | 'void'

type Colour = {
  r: number
  g: number
  b: number
  a: number
}

const SOLID_RADIUS = 3
const SOLID_DENSITY = 0.72

export class TrackSurfaceMap {
  readonly width: number
  readonly height: number

  private readonly pixels: Uint8ClampedArray

  constructor(scene: Phaser.Scene, textureKey: string) {
    const texture = scene.textures.get(textureKey)
    const sourceImage = texture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }

    this.width = sourceImage.width
    this.height = sourceImage.height

    const canvas = document.createElement('canvas')
    canvas.width = this.width
    canvas.height = this.height

    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      throw new Error('Could not create track surface canvas context')
    }

    context.imageSmoothingEnabled = false
    context.drawImage(sourceImage, 0, 0)
    this.pixels = context.getImageData(0, 0, this.width, this.height).data
  }

  sample(x: number, y: number): TrackSurface {
    const pixel = this.getPixel(Math.floor(x), Math.floor(y))

    if (!pixel) {
      return 'void'
    }

    if (this.isBarrierColour(pixel)) {
      return 'barrier'
    }

    const maxChannel = Math.max(pixel.r, pixel.g, pixel.b)
    const minChannel = Math.min(pixel.r, pixel.g, pixel.b)
    const saturation = maxChannel - minChannel
    const brightness = (pixel.r + pixel.g + pixel.b) / 3

    const looksLikeTarmac =
      pixel.a > 16 &&
      saturation < 24 &&
      brightness >= 65 &&
      brightness <= 175

    return looksLikeTarmac ? 'road' : 'offRoad'
  }

  collidesAlongSegment(fromX: number, fromY: number, toX: number, toY: number) {
    const dx = toX - fromX
    const dy = toY - fromY
    const distance = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.ceil(distance))

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps
      const x = fromX + dx * progress
      const y = fromY + dy * progress

      if (this.hasSolidBarrierAt(x, y)) {
        return true
      }
    }

    return false
  }

  private hasSolidBarrierAt(x: number, y: number) {
    let barrierPixels = 0
    let sampledPixels = 0

    for (let offsetY = -SOLID_RADIUS; offsetY <= SOLID_RADIUS; offsetY += 1) {
      for (let offsetX = -SOLID_RADIUS; offsetX <= SOLID_RADIUS; offsetX += 1) {
        const pixel = this.getPixel(
          Math.floor(x + offsetX),
          Math.floor(y + offsetY),
        )

        if (!pixel) {
          continue
        }

        sampledPixels += 1

        if (this.isBarrierColour(pixel)) {
          barrierPixels += 1
        }
      }
    }

    if (sampledPixels === 0) {
      return false
    }

    // The coloured block barriers are large, densely coloured regions. The
    // red/white kerbs contain lots of white between their red stripes, so they
    // deliberately stay non-solid and continue to behave like rough bumps.
    return barrierPixels / sampledPixels >= SOLID_DENSITY
  }

  private isBarrierColour(pixel: Colour) {
    if (pixel.a <= 16) {
      return false
    }

    const red =
      pixel.r >= 185 &&
      pixel.g <= 85 &&
      pixel.b <= 85

    const blue =
      pixel.b >= 150 &&
      pixel.r <= 100 &&
      pixel.g <= 135

    const yellow =
      pixel.r >= 180 &&
      pixel.g >= 155 &&
      pixel.b <= 95

    const green =
      pixel.g >= 135 &&
      pixel.r <= 105 &&
      pixel.b <= 105

    return red || blue || yellow || green
  }

  private getPixel(x: number, y: number): Colour | undefined {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return undefined
    }

    const index = (y * this.width + x) * 4

    return {
      r: this.pixels[index],
      g: this.pixels[index + 1],
      b: this.pixels[index + 2],
      a: this.pixels[index + 3],
    }
  }
}
