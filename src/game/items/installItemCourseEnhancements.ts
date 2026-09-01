import Phaser from 'phaser'
import { ItemSystem } from './ItemSystem'

const TRACK_TEXTURE_KEY = 'prototype-track'
const ROUTE_SAMPLE_COUNT = 320
const COIN_SAMPLE_STEP = 6
const ITEM_BOX_COUNT = 10
const ITEM_BOX_RESPAWN_MS = 5000
const ITEM_BOX_MIN_DISTANCE_RATIO = 0.115
const CORNER_LOOKAHEAD = 5
const CORNER_MIN_ANGLE = 0.055
const CORNER_MIN_INDEX_DISTANCE = 24
const CORNER_COIN_LATERAL_SPACING_RATIO = 0.038
const CORNER_COIN_LONGITUDINAL_SPACING_RATIO = 0.036

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

type CourseBasis = {
  tangentX: number
  tangentY: number
  normalX: number
  normalY: number
}

type CornerCandidate = {
  index: number
  angle: number
}

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
    createCoinPickupVisual: (
      worldX: number,
      worldY: number,
      camera: CameraState,
    ) => void
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

    const itemBoxes = buildTenItemBoxes(
      route,
      clearance,
      system.worldScale,
      roadSampler,
      system.hooks.isBarrierAt,
    )
    system.itemBoxes.splice(0, system.itemBoxes.length, ...itemBoxes)

    const coinPositions: RoutePoint[] = []
    const spawnCoin = (point: RoutePoint, minimumSeparation: number) => {
      if (!isSafeRoadPoint(point, clearance, roadSampler, system.hooks.isBarrierAt)) return
      if (isTooCloseToItemBox(point, itemBoxes, system.worldScale * 0.033)) return
      if (
        coinPositions.some(
          (coin) => distanceSquared(coin, point) < minimumSeparation * minimumSeparation,
        )
      ) return

      coinPositions.push(point)
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

    for (
      let index = Math.floor(COIN_SAMPLE_STEP / 2);
      index < route.length;
      index += COIN_SAMPLE_STEP
    ) {
      spawnCoin(route[index], system.worldScale * 0.016)
    }

    for (const corner of findCornerCandidates(route)) {
      const centre = route[corner.index]
      const basis = getCourseBasis(route, corner.index, CORNER_LOOKAHEAD)
      const tightness = Phaser.Math.Clamp(
        (corner.angle - CORNER_MIN_ANGLE) / 0.24,
        0,
        1,
      )
      const rows = Phaser.Math.Clamp(3 + Math.round(tightness * 5), 3, 8)
      const columns = tightness > 0.58 ? 4 : 3
      const grid = buildCoinGrid(
        centre,
        basis,
        columns,
        rows,
        system.worldScale * CORNER_COIN_LATERAL_SPACING_RATIO,
        system.worldScale * CORNER_COIN_LONGITUDINAL_SPACING_RATIO,
      )

      for (const point of grid) {
        spawnCoin(point, system.worldScale * 0.014)
      }
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

  prototype.createCoinPickupVisual = function (
    this: ItemSystem,
    worldX: number,
    worldY: number,
    camera: CameraState,
  ) {
    createHeavyGoldCoinBurst(this as unknown as ItemSystemInternals, worldX, worldY, camera)
  }
}

function buildTenItemBoxes(
  route: RoutePoint[],
  clearance: number,
  worldScale: number,
  isRoad: (x: number, y: number) => boolean,
  isBarrier: (x: number, y: number) => boolean,
) {
  const boxes: ItemBoxState[] = []
  const minimumDistance = worldScale * ITEM_BOX_MIN_DISTANCE_RATIO

  for (let slot = 0; slot < ITEM_BOX_COUNT; slot += 1) {
    const targetIndex = Math.floor((slot / ITEM_BOX_COUNT) * route.length)
    const candidateOffsets = [0, 3, -3, 6, -6, 9, -9, 12, -12, 16, -16]

    for (const offset of candidateOffsets) {
      const index = (targetIndex + offset + route.length) % route.length
      const centre = route[index]
      const basis = getCourseBasis(route, index, 3)
      const lateralCandidates = [0, 0.035, -0.035, 0.02, -0.02]
      let placed = false

      for (const lateralRatio of lateralCandidates) {
        const point = {
          x: centre.x + basis.normalX * worldScale * lateralRatio,
          y: centre.y + basis.normalY * worldScale * lateralRatio,
        }
        if (!isSafeRoadPoint(point, clearance, isRoad, isBarrier)) continue
        if (
          boxes.some(
            (box) => distanceSquared(point, box) < minimumDistance * minimumDistance,
          )
        ) continue

        boxes.push({
          id: `course-box-${boxes.length + 1}`,
          x: point.x,
          y: point.y,
          active: true,
        })
        placed = true
        break
      }

      if (placed) break
    }
  }

  return boxes.slice(0, ITEM_BOX_COUNT)
}

function createHeavyGoldCoinBurst(
  system: ItemSystemInternals,
  worldX: number,
  worldY: number,
  camera: CameraState,
) {
  const projected = system.renderer.projectWorldPoint(worldX, worldY, camera)
  if (!projected) return

  const scale = Phaser.Math.Clamp(projected.scale, 0.6, 1.7)
  const originX = projected.x
  const groundY = projected.y - 4 * scale
  const depth = 84 + projected.screenY * 0.01

  const flash = system.scene.add
    .ellipse(originX, groundY, 26 * scale, 9 * scale, 0xffd52a, 0.34)
    .setStrokeStyle(Math.max(2, 3 * scale), 0xffef8a, 0.95)
    .setDepth(depth)

  system.scene.tweens.add({
    targets: flash,
    scaleX: 4.2,
    scaleY: 2.5,
    alpha: 0,
    duration: 420,
    ease: 'Quad.easeOut',
    onComplete: () => flash.destroy(),
  })

  for (let index = 0; index < 42; index += 1) {
    const size = Phaser.Math.Between(2, 6) * scale
    const shard = system.scene.add
      .rectangle(
        originX + Phaser.Math.Between(-8, 8) * scale,
        groundY - Phaser.Math.Between(0, 8) * scale,
        size,
        size * Phaser.Math.FloatBetween(0.65, 1.8),
        index % 5 === 0 ? 0xfff4a3 : index % 2 === 0 ? 0xffd21f : 0xffa000,
        1,
      )
      .setDepth(depth + 2)
      .setRotation(Phaser.Math.FloatBetween(-Math.PI, Math.PI))

    const horizontal = Phaser.Math.Between(-72, 72) * scale
    const apexY = groundY - Phaser.Math.Between(38, 105) * scale
    const landingX = originX + horizontal
    const landingY = groundY + Phaser.Math.Between(-2, 5) * scale

    system.scene.tweens.add({
      targets: shard,
      x: originX + horizontal * 0.58,
      y: apexY,
      angle: Phaser.Math.Between(-220, 220),
      duration: Phaser.Math.Between(150, 240),
      ease: 'Quad.easeOut',
      onComplete: () => {
        system.scene.tweens.add({
          targets: shard,
          x: landingX,
          y: landingY,
          angle: shard.angle + Phaser.Math.Between(-180, 180),
          duration: Phaser.Math.Between(150, 230),
          ease: 'Quad.easeIn',
          onComplete: () => {
            const bounceHeight = Phaser.Math.Between(8, 25) * scale
            system.scene.tweens.add({
              targets: shard,
              x: landingX + horizontal * 0.12,
              y: landingY - bounceHeight,
              duration: Phaser.Math.Between(80, 130),
              ease: 'Quad.easeOut',
              yoyo: true,
              onComplete: () => {
                system.scene.tweens.add({
                  targets: shard,
                  x: shard.x + Phaser.Math.Between(-20, 20) * scale,
                  y: landingY + Phaser.Math.Between(1, 6) * scale,
                  angle: shard.angle + Phaser.Math.Between(-100, 100),
                  alpha: 0,
                  scaleX: 0.35,
                  scaleY: 0.35,
                  duration: Phaser.Math.Between(220, 420),
                  ease: 'Cubic.easeOut',
                  onComplete: () => shard.destroy(),
                })
              },
            })
          },
        })
      },
    })
  }

  for (let index = 0; index < 18; index += 1) {
    const spark = system.scene.add
      .circle(
        originX + Phaser.Math.Between(-6, 6) * scale,
        groundY,
        Phaser.Math.FloatBetween(1.2, 3.3) * scale,
        index % 3 === 0 ? 0xffffff : 0xffe34d,
        1,
      )
      .setDepth(depth + 3)

    const angle = Phaser.Math.FloatBetween(Math.PI, Math.PI * 2)
    const distance = Phaser.Math.Between(28, 90) * scale
    system.scene.tweens.add({
      targets: spark,
      x: originX + Math.cos(angle) * distance,
      y: groundY + Math.sin(angle) * distance * 0.72,
      alpha: 0,
      scale: 0.15,
      duration: Phaser.Math.Between(240, 460),
      ease: 'Quad.easeOut',
      onComplete: () => spark.destroy(),
    })
  }

  for (let index = 0; index < 12; index += 1) {
    const dust = system.scene.add
      .ellipse(
        originX + Phaser.Math.Between(-12, 12) * scale,
        groundY + Phaser.Math.Between(0, 5) * scale,
        Phaser.Math.Between(5, 11) * scale,
        Phaser.Math.Between(2, 5) * scale,
        0xc8922f,
        0.42,
      )
      .setDepth(depth - 1)

    system.scene.tweens.add({
      targets: dust,
      x: dust.x + Phaser.Math.Between(-35, 35) * scale,
      y: dust.y + Phaser.Math.Between(-3, 8) * scale,
      scaleX: Phaser.Math.FloatBetween(1.8, 3.2),
      scaleY: Phaser.Math.FloatBetween(1.1, 1.8),
      alpha: 0,
      duration: Phaser.Math.Between(420, 720),
      ease: 'Sine.easeOut',
      onComplete: () => dust.destroy(),
    })
  }
}

function buildCoinGrid(
  centre: RoutePoint,
  basis: CourseBasis,
  columns: number,
  rows: number,
  lateralSpacing: number,
  longitudinalSpacing: number,
) {
  const points: RoutePoint[] = []
  const columnCentre = (columns - 1) / 2
  const rowCentre = (rows - 1) / 2

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const lateral = (column - columnCentre) * lateralSpacing
      const longitudinal = (row - rowCentre) * longitudinalSpacing
      points.push({
        x: centre.x + basis.normalX * lateral + basis.tangentX * longitudinal,
        y: centre.y + basis.normalY * lateral + basis.tangentY * longitudinal,
      })
    }
  }

  return points
}

function findCornerCandidates(route: RoutePoint[]) {
  const candidates: CornerCandidate[] = []

  for (let index = 0; index < route.length; index += 1) {
    const angle = getCornerAngle(route, index)
    if (angle < CORNER_MIN_ANGLE) continue

    const before = getCornerAngle(route, (index - 2 + route.length) % route.length)
    const after = getCornerAngle(route, (index + 2) % route.length)
    if (angle < before || angle < after) continue

    candidates.push({ index, angle })
  }

  candidates.sort((a, b) => b.angle - a.angle)
  const selected: CornerCandidate[] = []
  for (const candidate of candidates) {
    const overlaps = selected.some((other) => {
      const direct = Math.abs(other.index - candidate.index)
      const wrapped = route.length - direct
      return Math.min(direct, wrapped) < CORNER_MIN_INDEX_DISTANCE
    })
    if (!overlaps) selected.push(candidate)
  }

  return selected.sort((a, b) => a.index - b.index)
}

function getCornerAngle(route: RoutePoint[], index: number) {
  const count = route.length
  const previous = route[(index - CORNER_LOOKAHEAD + count) % count]
  const centre = route[index]
  const next = route[(index + CORNER_LOOKAHEAD) % count]
  const incomingX = centre.x - previous.x
  const incomingY = centre.y - previous.y
  const outgoingX = next.x - centre.x
  const outgoingY = next.y - centre.y
  const incomingLength = Math.max(0.001, Math.hypot(incomingX, incomingY))
  const outgoingLength = Math.max(0.001, Math.hypot(outgoingX, outgoingY))
  const dot = Phaser.Math.Clamp(
    (incomingX * outgoingX + incomingY * outgoingY) /
      (incomingLength * outgoingLength),
    -1,
    1,
  )
  return Math.acos(dot)
}

function getCourseBasis(route: RoutePoint[], index: number, lookahead: number): CourseBasis {
  const count = route.length
  const previous = route[(index - lookahead + count) % count]
  const next = route[(index + lookahead) % count]
  const tangentXRaw = next.x - previous.x
  const tangentYRaw = next.y - previous.y
  const length = Math.max(0.001, Math.hypot(tangentXRaw, tangentYRaw))
  const tangentX = tangentXRaw / length
  const tangentY = tangentYRaw / length

  return {
    tangentX,
    tangentY,
    normalX: -tangentY,
    normalY: tangentX,
  }
}

function isTooCloseToItemBox(point: RoutePoint, itemBoxes: ItemBoxState[], distance: number) {
  const distanceSq = distance * distance
  return itemBoxes.some((box) => distanceSquared(point, box) < distanceSq)
}

function distanceSquared(a: RoutePoint, b: RoutePoint) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
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
