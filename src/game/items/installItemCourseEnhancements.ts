import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

const TRACK_TEXTURE_KEY = 'prototype-track'
const ROUTE_SAMPLE_COUNT = 320
const COIN_SAMPLE_STEP = 4
const ITEM_BOX_ROW_STEP = 28
const ITEM_BOX_RESPAWN_MS = 5000
const ITEM_BOX_LATERAL_SPACING_RATIO = 0.047
const ITEM_BOX_ROW_MIN_DISTANCE_RATIO = 0.105

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
type CameraState = unknown

type ItemSystemInternals = {
  scene: Phaser.Scene
  renderer: {
    sourceWidth: number
    sourceHeight: number
    projectWorldPoint: (
      x: number,
      y: number,
      camera: CameraState,
    ) => { x: number; y: number; screenY: number; scale: number } | undefined
  }
  worldScale: number
  itemBoxes: ItemBoxState[]
  pickupRadius: number
  heldItem?: string
  rouletteRunning: boolean
  hooks: {
    getRacers: () => readonly { id: string; x: number; y: number }[]
    ownerId: string
    isBarrierAt: (x: number, y: number) => boolean
  }
  refreshGroundPanels: () => void
  startRoulette: () => void
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
  retroKartLastCamera?: CameraState
}

let installed = false

export function installItemCourseEnhancements() {
  if (installed) return
  installed = true

  const prototype = ItemSystem.prototype as unknown as {
    update: (deltaSeconds: number, camera: CameraState) => void
    checkItemBoxPickup: () => void
    spawnTrackCoins: () => void
  }

  const originalUpdate = prototype.update
  prototype.update = function (
    this: ItemSystem,
    deltaSeconds: number,
    camera: CameraState,
  ) {
    const system = this as unknown as ItemSystemInternals
    system.retroKartLastCamera = camera
    originalUpdate.call(this, deltaSeconds, camera)
  }

  prototype.spawnTrackCoins = function (this: ItemSystem) {
    const system = this as unknown as ItemSystemInternals
    const roadSampler = createRoadSampler(system.scene)
    const route = buildCourseRoute(system.renderer.sourceWidth, system.renderer.sourceHeight)
    const clearance = Math.max(6, system.worldScale * 0.007)
    const lateralSpacing = system.worldScale * ITEM_BOX_LATERAL_SPACING_RATIO
    const minimumRowDistance = system.worldScale * ITEM_BOX_ROW_MIN_DISTANCE_RATIO

    const itemBoxes: ItemBoxState[] = []
    const rowCentres: RoutePoint[] = []

    for (let index = 0; index < route.length; index += ITEM_BOX_ROW_STEP) {
      const centre = route[index]
      const previous = route[(index - 2 + route.length) % route.length]
      const next = route[(index + 2) % route.length]
      const tangentX = next.x - previous.x
      const tangentY = next.y - previous.y
      const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY))
      const normalX = -tangentY / tangentLength
      const normalY = tangentX / tangentLength

      const row = [-1, 0, 1].map((lane) => ({
        x: centre.x + normalX * lateralSpacing * lane,
        y: centre.y + normalY * lateralSpacing * lane,
      }))

      const rowIsSafe = row.every((point) =>
        isSafeRoadPoint(point, clearance, roadSampler, system.hooks.isBarrierAt),
      )
      if (!rowIsSafe) continue

      const tooCloseToExistingRow = rowCentres.some((other) => {
        const dx = other.x - centre.x
        const dy = other.y - centre.y
        return dx * dx + dy * dy < minimumRowDistance * minimumRowDistance
      })
      if (tooCloseToExistingRow) continue

      rowCentres.push(centre)
      for (let lane = 0; lane < row.length; lane += 1) {
        const point = row[lane]
        itemBoxes.push({
          id: `course-box-row-${rowCentres.length}-lane-${lane + 1}`,
          x: point.x,
          y: point.y,
          active: true,
        })
      }
    }

    system.itemBoxes.splice(0, system.itemBoxes.length, ...itemBoxes)

    for (
      let index = Math.floor(COIN_SAMPLE_STEP / 2);
      index < route.length;
      index += COIN_SAMPLE_STEP
    ) {
      const point = route[index]
      if (!isSafeRoadPoint(point, clearance, roadSampler, system.hooks.isBarrierAt)) continue

      const tooCloseToBox = itemBoxes.some((box) => {
        const dx = box.x - point.x
        const dy = box.y - point.y
        const minDistance = system.worldScale * 0.035
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

  prototype.checkItemBoxPickup = function (this: ItemSystem) {
    const system = this as unknown as ItemSystemInternals
    if (system.heldItem || system.rouletteRunning) return

    const owner = system.hooks
      .getRacers()
      .find((racer) => racer.id === system.hooks.ownerId)
    if (!owner) return

    const pickupRadiusSq = system.pickupRadius * system.pickupRadius
    for (const itemBox of system.itemBoxes) {
      if (!itemBox.active) continue
      const dx = owner.x - itemBox.x
      const dy = owner.y - itemBox.y
      if (dx * dx + dy * dy > pickupRadiusSq) continue

      itemBox.active = false
      system.refreshGroundPanels()
      createItemBoxGroundBurst(system, itemBox.x, itemBox.y)
      system.startRoulette()

      system.scene.time.delayedCall(ITEM_BOX_RESPAWN_MS, () => {
        itemBox.active = true
        system.refreshGroundPanels()
      })
      break
    }
  }
}

function createItemBoxGroundBurst(
  system: ItemSystemInternals,
  worldX: number,
  worldY: number,
) {
  const camera = system.retroKartLastCamera
  if (!camera) return

  const projected = system.renderer.projectWorldPoint(worldX, worldY, camera)
  if (!projected) return

  const burstScale = Phaser.Math.Clamp(projected.scale, 0.55, 1.55)
  const originX = projected.x
  const originY = projected.y - 3 * burstScale

  const ring = system.scene.add
    .ellipse(originX, originY, 22 * burstScale, 8 * burstScale)
    .setStrokeStyle(Math.max(2, 3 * burstScale), 0xfff4a3, 0.95)
    .setFillStyle(0xffc928, 0.12)
    .setDepth(78 + projected.screenY * 0.01)

  system.scene.tweens.add({
    targets: ring,
    scaleX: 3.6,
    scaleY: 2.2,
    alpha: 0,
    duration: 340,
    ease: 'Quad.easeOut',
    onComplete: () => ring.destroy(),
  })

  for (let index = 0; index < 26; index += 1) {
    const angle = Phaser.Math.FloatBetween(-Math.PI * 0.9, -Math.PI * 0.1)
    const distance = Phaser.Math.Between(28, 78) * burstScale
    const rise = Phaser.Math.Between(28, 72) * burstScale
    const size = Phaser.Math.Between(2, 5) * burstScale
    const particle = system.scene.add
      .rectangle(
        originX + Phaser.Math.Between(-5, 5) * burstScale,
        originY,
        size,
        size * Phaser.Math.FloatBetween(1, 2.2),
        index % 4 === 0 ? 0xffffff : index % 2 === 0 ? 0xffef61 : 0xffa51f,
        1,
      )
      .setDepth(80 + projected.screenY * 0.01)
      .setRotation(Phaser.Math.FloatBetween(-1, 1))

    const targetX = originX + Math.cos(angle) * distance
    const targetY = originY - rise + Math.sin(angle) * distance * 0.22

    system.scene.tweens.add({
      targets: particle,
      x: targetX,
      y: targetY,
      angle: Phaser.Math.Between(-240, 240),
      scale: 0.25,
      alpha: 0,
      duration: Phaser.Math.Between(300, 520),
      ease: 'Cubic.easeOut',
      onComplete: () => particle.destroy(),
    })
  }

  for (let index = 0; index < 10; index += 1) {
    const puff = system.scene.add
      .circle(
        originX + Phaser.Math.Between(-9, 9) * burstScale,
        originY + Phaser.Math.Between(-2, 4) * burstScale,
        Phaser.Math.Between(3, 7) * burstScale,
        0xf1d38b,
        0.62,
      )
      .setDepth(77 + projected.screenY * 0.01)

    system.scene.tweens.add({
      targets: puff,
      x: puff.x + Phaser.Math.Between(-20, 20) * burstScale,
      y: puff.y - Phaser.Math.Between(12, 30) * burstScale,
      scale: Phaser.Math.FloatBetween(1.5, 2.5),
      alpha: 0,
      duration: Phaser.Math.Between(360, 620),
      ease: 'Sine.easeOut',
      onComplete: () => puff.destroy(),
    })
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
  const source = texture.getSourceImage() as CanvasImageSource & {
    width: number
    height: number
  }
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
