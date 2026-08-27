import Phaser from 'phaser'

export type TrackSurface = 'road' | 'offRoad' | 'void'

type Colour = {
  r: number
  g: number
  b: number
  a: number
}

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

    // Mario Circuit's drivable tarmac is deliberately neutral grey. Keep the
    // classifier local to this temporary prototype asset so the gameplay model
    // can later consume authored surface data without knowing anything about
    // Nintendo palette values.
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
