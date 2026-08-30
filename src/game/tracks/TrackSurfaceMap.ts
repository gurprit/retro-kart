import Phaser from 'phaser'

export type TrackSurface = 'road' | 'offRoad' | 'barrier' | 'void'

type Colour = {
  r: number
  g: number
  b: number
  a: number
}

const MASK_SOLID_THRESHOLD = 180
const COLLISION_RADIUS = 2

export class TrackSurfaceMap {
  readonly width: number
  readonly height: number

  private readonly surfacePixels: Uint8ClampedArray
  private readonly collisionPixels: Uint8ClampedArray

  constructor(
    scene: Phaser.Scene,
    surfaceTextureKey: string,
    collisionTextureKey: string,
  ) {
    const surfaceTexture = scene.textures.get(surfaceTextureKey)
    const collisionTexture = scene.textures.get(collisionTextureKey)

    const surfaceImage = surfaceTexture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }
    const collisionImage = collisionTexture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }

    this.width = surfaceImage.width
    this.height = surfaceImage.height

    if (
      collisionImage.width !== this.width ||
      collisionImage.height !== this.height
    ) {
      throw new Error(
        `Collision mask must match track dimensions (${this.width}x${this.height})`,
      )
    }

    this.surfacePixels = this.readPixels(surfaceImage, this.width, this.height)
    this.collisionPixels = this.readPixels(
      collisionImage,
      collisionImage.width,
      collisionImage.height,
    )
  }

  sample(x: number, y: number): TrackSurface {
    if (!this.isInside(x, y)) {
      return 'void'
    }

    if (this.isSolid(x, y)) {
      return 'barrier'
    }

    const pixel = this.getSurfacePixel(Math.floor(x), Math.floor(y))

    if (!pixel) {
      return 'void'
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
    const steps = Math.max(1, Math.ceil(distance * 2))

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
    for (let offsetY = -COLLISION_RADIUS; offsetY <= COLLISION_RADIUS; offsetY += 1) {
      for (let offsetX = -COLLISION_RADIUS; offsetX <= COLLISION_RADIUS; offsetX += 1) {
        if (this.isSolid(x + offsetX, y + offsetY)) {
          return true
        }
      }
    }

    return false
  }

  private isSolid(x: number, y: number) {
    const pixel = this.getCollisionPixel(Math.floor(x), Math.floor(y))

    if (!pixel) {
      return false
    }

    const brightness = (pixel.r + pixel.g + pixel.b) / 3

    return pixel.a > 16 && brightness >= MASK_SOLID_THRESHOLD
  }

  private readPixels(image: CanvasImageSource, width: number, height: number) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d', { willReadFrequently: true })

    if (!context) {
      throw new Error('Could not create track map canvas context')
    }

    context.imageSmoothingEnabled = false
    context.drawImage(image, 0, 0)

    return context.getImageData(0, 0, width, height).data
  }

  private isInside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  private getSurfacePixel(x: number, y: number): Colour | undefined {
    return this.getPixel(this.surfacePixels, x, y)
  }

  private getCollisionPixel(x: number, y: number): Colour | undefined {
    return this.getPixel(this.collisionPixels, x, y)
  }

  private getPixel(
    pixels: Uint8ClampedArray,
    x: number,
    y: number,
  ): Colour | undefined {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return undefined
    }

    const index = (y * this.width + x) * 4

    return {
      r: pixels[index],
      g: pixels[index + 1],
      b: pixels[index + 2],
      a: pixels[index + 3],
    }
  }
}
