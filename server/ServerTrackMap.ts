export type ServerTrackSurface = 'road' | 'offRoad' | 'barrier' | 'void'

export type TrackPixelSource = {
  width: number
  height: number
  data: Uint8Array
}

export type ClassifiedTrackMasks = {
  width: number
  height: number
  roadMask: Uint8Array
  solidMask: Uint8Array
}

const MASK_SOLID_THRESHOLD = 180
const COLLISION_RADIUS = 7

function bitMaskLength(width: number, height: number) {
  return Math.ceil((width * height) / 8)
}

function setBit(mask: Uint8Array, index: number) {
  mask[index >> 3] |= 1 << (index & 7)
}

function hasBit(mask: Uint8Array, index: number) {
  return (mask[index >> 3] & (1 << (index & 7))) !== 0
}

export function classifyTrackMasks(
  surface: TrackPixelSource,
  collision: TrackPixelSource,
): ClassifiedTrackMasks {
  if (surface.width !== collision.width || surface.height !== collision.height) {
    throw new Error(
      `Collision mask must match track dimensions (${surface.width}x${surface.height})`,
    )
  }

  const { width, height } = surface
  const roadMask = new Uint8Array(bitMaskLength(width, height))
  const solidMask = new Uint8Array(bitMaskLength(width, height))

  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const offset = pixelIndex * 4

    const collisionR = collision.data[offset]
    const collisionG = collision.data[offset + 1]
    const collisionB = collision.data[offset + 2]
    const collisionA = collision.data[offset + 3]
    const collisionBrightness = (collisionR + collisionG + collisionB) / 3
    if (collisionA > 16 && collisionBrightness >= MASK_SOLID_THRESHOLD) {
      setBit(solidMask, pixelIndex)
    }

    const r = surface.data[offset]
    const g = surface.data[offset + 1]
    const b = surface.data[offset + 2]
    const a = surface.data[offset + 3]
    const maxChannel = Math.max(r, g, b)
    const minChannel = Math.min(r, g, b)
    const saturation = maxChannel - minChannel
    const brightness = (r + g + b) / 3
    const looksLikeTarmac =
      a > 16 && saturation < 24 && brightness >= 65 && brightness <= 175

    if (looksLikeTarmac) setBit(roadMask, pixelIndex)
  }

  return { width, height, roadMask, solidMask }
}

export class ServerTrackMap {
  readonly width: number
  readonly height: number

  constructor(
    width: number,
    height: number,
    private readonly roadMask: Uint8Array,
    private readonly solidMask: Uint8Array,
  ) {
    const expectedLength = bitMaskLength(width, height)
    if (roadMask.length !== expectedLength || solidMask.length !== expectedLength) {
      throw new Error(`Track bitmasks must contain ${expectedLength} bytes`)
    }
    this.width = width
    this.height = height
  }

  static fromPixels(surface: TrackPixelSource, collision: TrackPixelSource) {
    const classified = classifyTrackMasks(surface, collision)
    return new ServerTrackMap(
      classified.width,
      classified.height,
      classified.roadMask,
      classified.solidMask,
    )
  }

  static fromMasks(
    width: number,
    height: number,
    roadMask: Uint8Array,
    solidMask: Uint8Array,
  ) {
    return new ServerTrackMap(width, height, roadMask, solidMask)
  }

  sample(x: number, y: number): ServerTrackSurface {
    if (!this.isInside(x, y)) return 'void'
    if (this.isSolid(x, y)) return 'barrier'
    return this.isRoad(x, y) ? 'road' : 'offRoad'
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

  private isRoad(x: number, y: number) {
    const pixelIndex = this.pixelIndex(Math.floor(x), Math.floor(y))
    return pixelIndex === undefined ? false : hasBit(this.roadMask, pixelIndex)
  }

  private isSolid(x: number, y: number) {
    const pixelIndex = this.pixelIndex(Math.floor(x), Math.floor(y))
    return pixelIndex === undefined ? false : hasBit(this.solidMask, pixelIndex)
  }

  private isInside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  private pixelIndex(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return undefined
    return y * this.width + x
  }
}
