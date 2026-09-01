import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

const COIN_FRAME_MARKER = 'retro-kart-coin-frame-'
const BACKGROUND_TOLERANCE = 70
const TRACK_COIN_SIZE_MULTIPLIER = 3
const TRACK_TEXTURE_KEY = 'prototype-track'
const ROUTE_SAMPLE_COUNT = 240
const COIN_SAMPLE_STEP = 6
const ITEM_BOX_SAMPLE_STEP = 24

const COURSE_ROUTE = [
  { x: 0.91, y: 0.61 },
  { x: 0.91, y: 0.57 },
  { x: 0.89, y: 0.53 },
  { x: 0.78, y: 0.49 },
  { x: 0.66, y: 0.45 },
  { x: 0.53, y: 0.42 },
  { x: 0.4, y: 0.46 },
  { x: 0.31, y: 0.56 },
  { x: 0.42, y: 0.67 },
  { x: 0.64, y: 0.68 },
] as const

type RoutePoint = { x: number; y: number }
type ItemBoxState = { id: string; x: number; y: number; active: boolean }

let installed = false

export function installItemVisualFixes() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    createStandaloneFrame: (
      textureKey: string,
      frameName: string,
      outputKey: string,
    ) => string | undefined
    updateWorldItemVisual: (item: unknown, camera: unknown) => void
    spawnTrackCoins: () => void
    spawnWorldItem: (
      kind: string,
      ownerId: string,
      x: number,
      y: number,
      vx: number,
      vy: number,
      ttl: number,
      ownerGrace: number,
      trackCoin?: boolean,
    ) => unknown
  }

  const originalCreateStandaloneFrame = prototype.createStandaloneFrame
  prototype.createStandaloneFrame = function (
    this: ItemSystem,
    textureKey: string,
    frameName: string,
    outputKey: string,
  ) {
    const result = originalCreateStandaloneFrame.call(this, textureKey, frameName, outputKey)
    if (!result || !outputKey.includes(COIN_FRAME_MARKER)) return result

    const system = this as unknown as { scene: Phaser.Scene }
    const texture = system.scene.textures.get(outputKey)
    const source = texture.getSourceImage() as HTMLCanvasElement
    const context = source.getContext('2d', { willReadFrequently: true })
    if (!context) return result

    const imageData = context.getImageData(0, 0, source.width, source.height)
    const pixels = imageData.data
    const cornerOffsets = [
      0,
      (source.width - 1) * 4,
      ((source.height - 1) * source.width) * 4,
      ((source.height * source.width) - 1) * 4,
    ]
    const backgrounds = cornerOffsets.map((offset) => ({
      r: pixels[offset],
      g: pixels[offset + 1],
      b: pixels[offset + 2],
    }))

    for (let offset = 0; offset < pixels.length; offset += 4) {
      const r = pixels[offset]
      const g = pixels[offset + 1]
      const b = pixels[offset + 2]
      const matchesBackground = backgrounds.some(
        (background) =>
          Math.abs(r - background.r) +
            Math.abs(g - background.g) +
            Math.abs(b - background.b) <=
          BACKGROUND_TOLERANCE,
      )
      if (matchesBackground) pixels[offset + 3] = 0
    }

    context.clearRect(0, 0, source.width, source.height)
    context.putImageData(imageData, 0, 0)
    const canvasTexture = texture as Phaser.Textures.CanvasTexture
    canvasTexture.refresh()
    return result
  }

  prototype.spawnTrackCoins = function (this: ItemSystem) {
    const system = this as unknown as {
      scene: Phaser.Scene
      renderer: { sourceWidth: number; sourceHeight: number }
      worldScale: number
      itemBoxes: ItemBoxState[]
      hooks: { isBarrierAt: (x: number, y: number) => boolean }
      spawnWorldItem: (
        kind: string,
        ownerId: string,
        x: number,
        y: number,
        vx: number,
        vy: number,
        ttl: number,
        ownerGrace: number,
        trackCoin?: boolean,
      ) => unknown
    }

    const roadSampler = createRoadSampler(system.scene)
    const route = buildCourseRoute(system.renderer.sourceWidth, system.renderer.sourceHeight)
    const clearance = Math.max(6, system.worldScale * 0.007)
    const validRoute = route.filter((point) =>
      isSafeRoadPoint(point, clearance, roadSampler, system.hooks.isBarrierAt),
    )

    const itemBoxes: ItemBoxState[] = []
    for (let index = 0; index < validRoute.length; index += ITEM_BOX_SAMPLE_STEP) {
      const point = validRoute[index]
      itemBoxes.push({
        id: `course-box-${itemBoxes.length + 1}`,
        x: point.x,
        y: point.y,
        active: true,
      })
    }
    system.itemBoxes.splice(0, system.itemBoxes.length, ...itemBoxes)

    for (let index = Math.floor(COIN_SAMPLE_STEP / 2); index < validRoute.length; index += COIN_SAMPLE_STEP) {
      const point = validRoute[index]
      const tooCloseToBox = itemBoxes.some((box) => {
        const dx = box.x - point.x
        const dy = box.y - point.y
        const minDistance = system.worldScale * 0.045
        return dx * dx + dy * dy < minDistance * minDistance
      })
      if (tooCloseToBox) continue

      system.spawnWorldItem(
        'coin',
        'track',
        point.x,
        point.y,
        0,
        0,
        Number.POSITIVE_INFINITY,
        0,
        true,
      )
    }
  }

  const originalUpdateWorldItemVisual = prototype.updateWorldItemVisual
  prototype.updateWorldItemVisual = function (
    this: ItemSystem,
    itemValue: unknown,
    cameraValue: unknown,
  ) {
    originalUpdateWorldItemVisual.call(this, itemValue, cameraValue)

    const item = itemValue as {
      kind: string
      id: number
      x: number
      y: number
      image: Phaser.GameObjects.Image
    }
    if (item.kind !== 'coin' || !item.image.visible) return

    const system = this as unknown as {
      scene: Phaser.Scene
      renderer: {
        projectWorldPoint: (
          x: number,
          y: number,
          camera: unknown,
        ) => { x: number; y: number; screenY: number } | undefined
      }
    }
    const projected = system.renderer.projectWorldPoint(item.x, item.y, cameraValue)
    if (!projected) return

    const viewportHeight = Math.max(1, system.scene.scale.height)
    const horizonY = viewportHeight * 0.28
    const nearY = viewportHeight * 0.92
    const depth = Phaser.Math.Clamp(
      (projected.screenY - horizonY) / Math.max(1, nearY - horizonY),
      0,
      1,
    )
    const easedDepth = Phaser.Math.Easing.Quadratic.In(depth)
    const size = Phaser.Math.Linear(11, 36, easedDepth) * TRACK_COIN_SIZE_MULTIPLIER
    const bob = Math.sin(system.scene.time.now * 0.01 + item.id) * 2

    item.image
      .setDisplaySize(size, size)
      .setPosition(projected.x, projected.y - size * 0.38 + bob)
  }
}

function buildCourseRoute(width: number, height: number) {
  const anchors = COURSE_ROUTE.map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }))
  const samples: RoutePoint[] = []

  for (let index = 0; index < ROUTE_SAMPLE_COUNT; index += 1) {
    const progress = (index / ROUTE_SAMPLE_COUNT) * anchors.length
    const segment = Math.floor(progress)
    const t = progress - segment
    const count = anchors.length
    const p0 = anchors[(segment - 1 + count) % count]
    const p1 = anchors[segment % count]
    const p2 = anchors[(segment + 1) % count]
    const p3 = anchors[(segment + 2) % count]
    samples.push({
      x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
      y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
    })
  }

  return samples
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  )
}

function createRoadSampler(scene: Phaser.Scene) {
  const texture = scene.textures.get(TRACK_TEXTURE_KEY)
  const source = texture.getSourceImage() as CanvasImageSource & { width: number; height: number }
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return () => false
  context.imageSmoothingEnabled = false
  context.drawImage(source, 0, 0)
  const pixels = context.getImageData(0, 0, source.width, source.height).data

  return (x: number, y: number) => {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || py < 0 || px >= source.width || py >= source.height) return false
    const offset = (py * source.width + px) * 4
    const r = pixels[offset]
    const g = pixels[offset + 1]
    const b = pixels[offset + 2]
    const a = pixels[offset + 3]
    const maxChannel = Math.max(r, g, b)
    const minChannel = Math.min(r, g, b)
    const saturation = maxChannel - minChannel
    const brightness = (r + g + b) / 3
    return a > 16 && saturation < 24 && brightness >= 65 && brightness <= 175
  }
}

function isSafeRoadPoint(
  point: RoutePoint,
  clearance: number,
  isRoad: (x: number, y: number) => boolean,
  isBarrier: (x: number, y: number) => boolean,
) {
  const checks = [
    [0, 0],
    [clearance, 0],
    [-clearance, 0],
    [0, clearance],
    [0, -clearance],
    [clearance * 0.7, clearance * 0.7],
    [-clearance * 0.7, clearance * 0.7],
    [clearance * 0.7, -clearance * 0.7],
    [-clearance * 0.7, -clearance * 0.7],
  ] as const

  return checks.every(([offsetX, offsetY]) => {
    const x = point.x + offsetX
    const y = point.y + offsetY
    return isRoad(x, y) && !isBarrier(x, y)
  })
}
