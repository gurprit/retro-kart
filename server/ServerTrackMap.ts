import fs from 'node:fs'
import { PNG } from 'pngjs'

export type ServerTrackSurface = 'road' | 'offRoad' | 'barrier' | 'void'

type PixelSource = {
  width: number
  height: number
  data: Uint8Array
}

const MASK_SOLID_THRESHOLD = 180
const COLLISION_RADIUS = 7

export class ServerTrackMap {
  readonly width: number
  readonly height: number

  private constructor(
    private readonly surface: PixelSource,
    private readonly collision: PixelSource,
  ) {
    this.width = surface.width
    this.height = surface.height
  }

  static async load(surfacePath: string, collisionPath: string) {
    const [surface, collision] = await Promise.all([
      ServerTrackMap.readPng(surfacePath),
      ServerTrackMap.readPng(collisionPath),
    ])

    if (surface.width !== collision.width || surface.height !== collision.height) {
      throw new Error(
        `Collision mask must match track dimensions (${surface.width}x${surface.height})`,
      )
    }

    return new ServerTrackMap(surface, collision)
  }

  sample(x: number, y: number): ServerTrackSurface {
    if (!this.isInside(x, y)) return 'void'
    if (this.isSolid(x, y)) return 'barrier'

    const offset = this.pixelOffset(this.surface, Math.floor(x), Math.floor(y))
    if (offset === undefined) return 'void'

    const r = this.surface.data[offset]
    const g = this.surface.data[offset + 1]
    const b = this.surface.data[offset + 2]
    const a = this.surface.data[offset + 3]
    const maxChannel = Math.max(r, g, b)
    const minChannel = Math.min(r, g, b)
    const saturation = maxChannel - minChannel
    const brightness = (r + g + b) / 3

    const looksLikeTarmac =
      a > 16 && saturation < 24 && brightness >= 65 && brightness <= 175

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
      if (this.hasSolidBarrierAt(x, y)) return true
    }

    return false
  }

  private hasSolidBarrierAt(x: number, y: number) {
    const radiusSquared = COLLISION_RADIUS * COLLISION_RADIUS

    for (let offsetY = -COLLISION_RADIUS; offsetY <= COLLISION_RADIUS; offsetY += 1) {
      for (let offsetX = -COLLISION_RADIUS; offsetX <= COLLISION_RADIUS; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > radiusSquared) continue
        if (this.isSolid(x + offsetX, y + offsetY)) return true
      }
    }

    return false
  }

  private isSolid(x: number, y: number) {
    const offset = this.pixelOffset(this.collision, Math.floor(x), Math.floor(y))
    if (offset === undefined) return false

    const r = this.collision.data[offset]
    const g = this.collision.data[offset + 1]
    const b = this.collision.data[offset + 2]
    const a = this.collision.data[offset + 3]
    const brightness = (r + g + b) / 3
    return a > 16 && brightness >= MASK_SOLID_THRESHOLD
  }

  private isInside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  private pixelOffset(source: PixelSource, x: number, y: number) {
    if (x < 0 || y < 0 || x >= source.width || y >= source.height) return undefined
    return (y * source.width + x) * 4
  }

  private static readPng(path: string): Promise<PixelSource> {
    return new Promise((resolve, reject) => {
      fs.createReadStream(path)
        .pipe(new PNG())
        .on('parsed', function parsed(this: PNG) {
          resolve({ width: this.width, height: this.height, data: this.data })
        })
        .on('error', reject)
    })
  }
}
