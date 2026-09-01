import Phaser from 'phaser'
import {
  Mode7Renderer,
  type Mode7CameraState,
  type Mode7GroundSprite,
} from '../rendering/Mode7Renderer'

export type ItemType =
  | 'banana'
  | 'bomb'
  | 'coin'
  | 'egg'
  | 'fireball'
  | 'greenShell'
  | 'redShell'
  | 'mushroom'
  | 'star'

export type ItemRacerState = {
  id: string
  x: number
  y: number
  angle: number
  speedRatio: number
  invulnerable: boolean
}

export type ItemSystemHooks = {
  ownerId: string
  getRacers: () => readonly ItemRacerState[]
  spinOutRacer: (
    racerId: string,
    blastX: number,
    blastY: number,
    pushStrength: number,
    controlLockSeconds: number,
  ) => void
  boostRacer: (racerId: string, multiplier: number, durationSeconds: number) => void
  grantStar: (racerId: string, durationSeconds: number) => void
  addCoin: (racerId: string, amount: number) => void
  isBarrierAt: (x: number, y: number) => boolean
}

type ItemBox = { id: string; x: number; y: number; active: boolean }
type RouletteFrame = { name: string; x: number; y: number }
type WorldItemKind =
  | 'banana'
  | 'bomb'
  | 'coin'
  | 'greenShell'
  | 'redShell'
  | 'fireball'
  | 'egg'

type WorldItem = {
  id: number
  kind: WorldItemKind
  ownerId: string
  x: number
  y: number
  vx: number
  vy: number
  ttl: number
  ownerGrace: number
  fuse?: number
  trackCoin?: boolean
  frameKeys: string[]
  animationFps: number
  image: Phaser.GameObjects.Image
}

type WorldFrameConfig = {
  textureKey: string
  frameCount: number
  vertical?: boolean
  fps?: number
}

const PICKUP_RADIUS_RATIO = 0.035
const ITEM_BOX_RESPAWN_MS = 5000
const PANEL_FRAME_MS = 50
const PANEL_TEXTURE_KEY = 'item-panels-mode7'
const PANEL_SIZE = 32
const ACTIVE_PANEL_FRAMES = 24
const EMPTY_PANEL_FRAME = ACTIVE_PANEL_FRAMES
const PANEL_FRAME_COUNT = ACTIVE_PANEL_FRAMES + 1
const PANEL_WORLD_SCALE = 1.05

const ROULETTE_FRAME_WIDTH = 26
const ROULETTE_FRAME_HEIGHT = 18
const ROULETTE_START_X = 0
const ROULETTE_START_Y = 19
const ROULETTE_COLUMN_STRIDE = 27
const ROULETTE_ROW_STRIDE = 19
const ROULETTE_COLUMNS = 3
const ROULETTE_ROWS = 4
const ROULETTE_ICON_SCALE = 3
const ROULETTE_DURATION_MS = 1250
const ROULETTE_STEP_MS = 75
const ROULETTE_FRAME_PREFIX = 'roulette-item-'

const ITEM_LABELS: Record<ItemType, string> = {
  banana: 'BANANA',
  bomb: 'BOMB',
  coin: 'COIN',
  egg: 'EGG',
  fireball: 'FIREBALL',
  greenShell: 'GREEN SHELL',
  redShell: 'RED SHELL',
  mushroom: 'MUSHROOM',
  star: 'STAR',
}

const ITEM_POOL: ItemType[] = [
  'banana',
  'banana',
  'greenShell',
  'greenShell',
  'redShell',
  'mushroom',
  'mushroom',
  'coin',
  'coin',
  'fireball',
  'egg',
  'bomb',
  'star',
]

const ROULETTE_FRAMES: RouletteFrame[] = Array.from(
  { length: ROULETTE_COLUMNS * ROULETTE_ROWS },
  (_, index) => ({
    name: `${ROULETTE_FRAME_PREFIX}${index}`,
    x: ROULETTE_START_X + (index % ROULETTE_COLUMNS) * ROULETTE_COLUMN_STRIDE,
    y: ROULETTE_START_Y + Math.floor(index / ROULETTE_COLUMNS) * ROULETTE_ROW_STRIDE,
  }),
)

// Item Roulette.png layout from the SNES sheet:
// 0 star, 1 banana, 2 green shell, 3 red shell, 6 coin, 7 lightning,
// 8 mushroom, 10 feather. Custom items deliberately reuse only frames from
// this sheet so no JPG artwork ever appears in the roulette/HUD.
const ROULETTE_FRAME_BY_ITEM: Record<ItemType, number> = {
  star: 0,
  banana: 1,
  greenShell: 2,
  redShell: 3,
  coin: 6,
  fireball: 7,
  mushroom: 8,
  bomb: 8,
  egg: 10,
}
const ROULETTE_CYCLE_FRAMES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10] as const

const WORLD_FRAME_CONFIG: Record<WorldItemKind, WorldFrameConfig> = {
  banana: { textureKey: 'item-banana', frameCount: 1 },
  bomb: { textureKey: 'item-bomb', frameCount: 1 },
  coin: { textureKey: 'item-coin', frameCount: 3, vertical: true, fps: 10 },
  greenShell: { textureKey: 'item-green-shell', frameCount: 3, fps: 12 },
  redShell: { textureKey: 'item-red-shell', frameCount: 1 },
  fireball: { textureKey: 'item-fireball', frameCount: 5, fps: 15 },
  egg: { textureKey: 'item-egg', frameCount: 1 },
}

const MARIO_CIRCUIT_ITEM_BOXES = [
  { id: 'mc1-1', xRatio: 0.83, yRatio: 0.5 },
  { id: 'mc1-2', xRatio: 0.87, yRatio: 0.5 },
  { id: 'mc1-3', xRatio: 0.91, yRatio: 0.5 },
  { id: 'mc1-4', xRatio: 0.95, yRatio: 0.5 },
  { id: 'mc1-5', xRatio: 0.99, yRatio: 0.5 },
] as const

const MARIO_CIRCUIT_TRACK_COINS = [
  { xRatio: 0.91, yRatio: 0.61 },
  { xRatio: 0.91, yRatio: 0.57 },
  { xRatio: 0.89, yRatio: 0.53 },
  { xRatio: 0.78, yRatio: 0.49 },
  { xRatio: 0.66, yRatio: 0.45 },
  { xRatio: 0.53, yRatio: 0.42 },
  { xRatio: 0.4, yRatio: 0.46 },
  { xRatio: 0.31, yRatio: 0.56 },
  { xRatio: 0.42, yRatio: 0.67 },
  { xRatio: 0.64, yRatio: 0.68 },
] as const

const WORLD_ITEM_SIZE = 38
const WORLD_ITEM_HIT_RADIUS_RATIO = 0.025
const BANANA_DROP_DISTANCE_RATIO = 0.012
const PROJECTILE_START_DISTANCE_RATIO = 0.055
const SHELL_SPEED_RATIO = 0.62
const FIREBALL_SPEED_RATIO = 0.68
const EGG_SPEED_RATIO = 0.56
const BOMB_THROW_SPEED_RATIO = 0.24
const BOMB_FUSE_SECONDS = 1.05
const BOMB_BLAST_RADIUS_RATIO = 0.145
const BOMB_PUSH_STRENGTH_RATIO = 0.22
const BOMB_CONTROL_LOCK_SECONDS = 1.05
const PROJECTILE_CONTROL_LOCK_SECONDS = 0.72
const PROJECTILE_PUSH_RATIO = 0.105
const TRACK_COIN_RESPAWN_MS = 4500
const STAR_DURATION_SECONDS = 6
const MUSHROOM_DURATION_SECONDS = 0.9
const MUSHROOM_MULTIPLIER = 1.55
const STAR_EVENT = 'retro-kart:star-activated'

export class ItemSystem {
  private readonly scene: Phaser.Scene
  private readonly renderer: Mode7Renderer
  private readonly worldScale: number
  private readonly rouletteTextureKey: string
  private readonly hooks: ItemSystemHooks
  private readonly itemBoxes: ItemBox[]
  private readonly pickupRadius: number
  private readonly worldItemHitRadius: number
  private readonly worldItems: WorldItem[] = []
  private readonly worldFrames = new Map<WorldItemKind, string[]>()

  private heldItem?: ItemType
  private rouletteResult?: ItemType
  private rouletteRunning = false
  private rouletteFrameIndex = 0
  private panelFrame = 0
  private nextWorldItemId = 1
  private panelTimer?: Phaser.Time.TimerEvent
  private rouletteTimer?: Phaser.Time.TimerEvent
  private rouletteFinishTimer?: Phaser.Time.TimerEvent
  private readonly rouletteSprite: Phaser.GameObjects.Image
  private readonly heldText: Phaser.GameObjects.Text

  constructor(
    scene: Phaser.Scene,
    renderer: Mode7Renderer,
    worldScale: number,
    rouletteTextureKey: string,
    hooks: ItemSystemHooks,
  ) {
    this.scene = scene
    this.renderer = renderer
    this.worldScale = worldScale
    this.rouletteTextureKey = rouletteTextureKey
    this.hooks = hooks
    this.pickupRadius = worldScale * PICKUP_RADIUS_RATIO
    this.worldItemHitRadius = worldScale * WORLD_ITEM_HIT_RADIUS_RATIO

    this.createPanelTexture()
    this.registerRouletteFrames(rouletteTextureKey)
    this.registerWorldItemFrames()

    this.itemBoxes = MARIO_CIRCUIT_ITEM_BOXES.map((definition) => ({
      id: definition.id,
      x: renderer.sourceWidth * definition.xRatio,
      y: renderer.sourceHeight * definition.yRatio,
      active: true,
    }))

    this.rouletteSprite = scene.add
      .image(90, 124, rouletteTextureKey, ROULETTE_FRAMES[0].name)
      .setDepth(41)
      .setOrigin(0.5)
      .setScale(ROULETTE_ICON_SCALE)
      .setVisible(false)

    this.heldText = scene.add
      .text(90, 158, '', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setDepth(42)

    this.panelTimer = scene.time.addEvent({
      delay: PANEL_FRAME_MS,
      loop: true,
      callback: () => {
        this.panelFrame = (this.panelFrame + 1) % ACTIVE_PANEL_FRAMES
        this.refreshGroundPanels()
      },
    })

    this.spawnTrackCoins()
    this.refreshGroundPanels()
  }

  update(deltaSeconds: number, camera: Mode7CameraState) {
    this.checkItemBoxPickup()
    this.updateWorldItems(deltaSeconds, camera)
  }

  useHeldItem() {
    if (!this.heldItem || this.rouletteRunning) return undefined
    const item = this.heldItem
    this.heldItem = undefined
    this.updateHeldHud()
    this.activateItem(item)
    return item
  }

  get currentItem() {
    return this.heldItem
  }

  destroy() {
    this.panelTimer?.destroy()
    this.rouletteTimer?.destroy()
    this.rouletteFinishTimer?.destroy()
    this.renderer.setGroundSprites(PANEL_TEXTURE_KEY, [])
    this.rouletteSprite.destroy()
    this.heldText.destroy()
    for (const item of this.worldItems) item.image.destroy()
    this.worldItems.length = 0
    if (this.scene.textures.exists(PANEL_TEXTURE_KEY)) {
      this.scene.textures.remove(PANEL_TEXTURE_KEY)
    }
  }

  private checkItemBoxPickup() {
    if (this.heldItem || this.rouletteRunning) return
    const owner = this.hooks.getRacers().find((racer) => racer.id === this.hooks.ownerId)
    if (!owner) return

    const pickupRadiusSq = this.pickupRadius * this.pickupRadius
    for (const itemBox of this.itemBoxes) {
      if (!itemBox.active) continue
      const dx = owner.x - itemBox.x
      const dy = owner.y - itemBox.y
      if (dx * dx + dy * dy <= pickupRadiusSq) {
        this.collect(itemBox)
        break
      }
    }
  }

  private collect(itemBox: ItemBox) {
    itemBox.active = false
    this.refreshGroundPanels()
    this.startRoulette()

    this.scene.time.delayedCall(ITEM_BOX_RESPAWN_MS, () => {
      itemBox.active = true
      this.refreshGroundPanels()
    })
  }

  private startRoulette() {
    this.rouletteRunning = true
    this.rouletteResult = ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)]
    this.rouletteFrameIndex = 0
    this.rouletteSprite
      .setTexture(this.rouletteTextureKey, ROULETTE_FRAMES[0].name)
      .setScale(ROULETTE_ICON_SCALE)
      .setVisible(true)
    this.applyRouletteFrame(ROULETTE_CYCLE_FRAMES[0])
    this.heldText.setText('ROULETTE')

    this.rouletteTimer?.destroy()
    this.rouletteTimer = this.scene.time.addEvent({
      delay: ROULETTE_STEP_MS,
      loop: true,
      callback: () => {
        this.rouletteFrameIndex =
          (this.rouletteFrameIndex + 1) % ROULETTE_CYCLE_FRAMES.length
        this.applyRouletteFrame(ROULETTE_CYCLE_FRAMES[this.rouletteFrameIndex])
      },
    })

    this.rouletteFinishTimer?.destroy()
    this.rouletteFinishTimer = this.scene.time.delayedCall(ROULETTE_DURATION_MS, () => {
      this.rouletteTimer?.destroy()
      this.rouletteTimer = undefined
      this.rouletteRunning = false
      this.heldItem = this.rouletteResult ?? 'banana'
      this.rouletteResult = undefined
      this.updateHeldHud()
    })
  }

  private activateItem(item: ItemType) {
    const owner = this.hooks.getRacers().find((racer) => racer.id === this.hooks.ownerId)
    if (!owner) return

    switch (item) {
      case 'banana':
        this.spawnBanana(owner)
        break
      case 'greenShell':
        this.spawnProjectile('greenShell', owner, SHELL_SPEED_RATIO)
        break
      case 'redShell':
        this.spawnProjectile('redShell', owner, SHELL_SPEED_RATIO * 0.93)
        break
      case 'fireball':
        this.spawnProjectile('fireball', owner, FIREBALL_SPEED_RATIO)
        break
      case 'egg':
        this.spawnProjectile('egg', owner, EGG_SPEED_RATIO)
        break
      case 'bomb':
        this.spawnBomb(owner)
        break
      case 'mushroom':
        this.hooks.boostRacer(owner.id, MUSHROOM_MULTIPLIER, MUSHROOM_DURATION_SECONDS)
        break
      case 'star':
        this.hooks.grantStar(owner.id, STAR_DURATION_SECONDS)
        this.scene.events.emit(STAR_EVENT, owner.id, STAR_DURATION_SECONDS)
        break
      case 'coin':
        this.hooks.addCoin(owner.id, 2)
        break
    }
  }

  private spawnBanana(owner: ItemRacerState) {
    const distance = this.worldScale * BANANA_DROP_DISTANCE_RATIO
    this.spawnWorldItem(
      'banana',
      owner.id,
      owner.x - Math.sin(owner.angle) * distance,
      owner.y + Math.cos(owner.angle) * distance,
      0,
      0,
      14,
      0.8,
    )
  }

  private spawnProjectile(
    kind: 'greenShell' | 'redShell' | 'fireball' | 'egg',
    owner: ItemRacerState,
    speedRatio: number,
  ) {
    const startDistance = this.worldScale * PROJECTILE_START_DISTANCE_RATIO
    const speed = this.worldScale * speedRatio
    const forwardX = Math.sin(owner.angle)
    const forwardY = -Math.cos(owner.angle)
    const ttl = kind === 'fireball' ? 4 : kind === 'egg' ? 5 : 7

    this.spawnWorldItem(
      kind,
      owner.id,
      owner.x + forwardX * startDistance,
      owner.y + forwardY * startDistance,
      forwardX * speed,
      forwardY * speed,
      ttl,
      0.45,
    )
  }

  private spawnBomb(owner: ItemRacerState) {
    const startDistance = this.worldScale * PROJECTILE_START_DISTANCE_RATIO
    const throwSpeed = this.worldScale * BOMB_THROW_SPEED_RATIO
    const forwardX = Math.sin(owner.angle)
    const forwardY = -Math.cos(owner.angle)
    const item = this.spawnWorldItem(
      'bomb',
      owner.id,
      owner.x + forwardX * startDistance,
      owner.y + forwardY * startDistance,
      forwardX * throwSpeed,
      forwardY * throwSpeed,
      BOMB_FUSE_SECONDS + 0.1,
      0.25,
    )
    item.fuse = BOMB_FUSE_SECONDS
  }

  private spawnTrackCoins() {
    for (const definition of MARIO_CIRCUIT_TRACK_COINS) {
      this.spawnWorldItem(
        'coin',
        'track',
        this.renderer.sourceWidth * definition.xRatio,
        this.renderer.sourceHeight * definition.yRatio,
        0,
        0,
        Number.POSITIVE_INFINITY,
        0,
        true,
      )
    }
  }

  private spawnWorldItem(
    kind: WorldItemKind,
    ownerId: string,
    x: number,
    y: number,
    vx: number,
    vy: number,
    ttl: number,
    ownerGrace: number,
    trackCoin = false,
  ) {
    const frameKeys = this.worldFrames.get(kind) ?? []
    if (frameKeys.length === 0) throw new Error(`Missing world item frames for ${kind}`)

    const image = this.scene.add
      .image(-1000, -1000, frameKeys[0])
      .setDepth(12)
      .setOrigin(0.5)
      .setVisible(false)

    const item: WorldItem = {
      id: this.nextWorldItemId++,
      kind,
      ownerId,
      x,
      y,
      vx,
      vy,
      ttl,
      ownerGrace,
      trackCoin,
      frameKeys,
      animationFps: WORLD_FRAME_CONFIG[kind].fps ?? 0,
      image,
    }
    this.worldItems.push(item)
    return item
  }

  private updateWorldItems(deltaSeconds: number, camera: Mode7CameraState) {
    for (let index = this.worldItems.length - 1; index >= 0; index -= 1) {
      const item = this.worldItems[index]
      item.ttl -= deltaSeconds
      item.ownerGrace = Math.max(0, item.ownerGrace - deltaSeconds)

      if (item.kind === 'bomb') {
        item.fuse = Math.max(0, (item.fuse ?? 0) - deltaSeconds)
        item.x += item.vx * deltaSeconds
        item.y += item.vy * deltaSeconds
        item.vx *= Math.pow(0.06, deltaSeconds)
        item.vy *= Math.pow(0.06, deltaSeconds)
        if ((item.fuse ?? 0) <= 0) {
          this.detonateBomb(item, camera)
          this.removeWorldItem(index)
          continue
        }
      } else if (item.kind !== 'banana' && item.kind !== 'coin') {
        this.updateProjectile(item, deltaSeconds)
      }

      if (item.ttl <= 0) {
        this.removeWorldItem(index)
        continue
      }

      if (this.checkWorldItemHits(item, camera)) {
        this.removeWorldItem(index)
        continue
      }

      this.updateWorldItemVisual(item, camera)
    }
  }

  private updateProjectile(item: WorldItem, deltaSeconds: number) {
    if (item.kind === 'redShell') this.homeRedShell(item, deltaSeconds)

    const nextX = item.x + item.vx * deltaSeconds
    const nextY = item.y + item.vy * deltaSeconds
    if (this.hooks.isBarrierAt(nextX, nextY)) {
      if (item.kind === 'greenShell') {
        const hitX = this.hooks.isBarrierAt(nextX, item.y)
        const hitY = this.hooks.isBarrierAt(item.x, nextY)
        if (hitX || (!hitX && !hitY)) item.vx *= -1
        if (hitY || (!hitX && !hitY)) item.vy *= -1
        item.x += item.vx * deltaSeconds
        item.y += item.vy * deltaSeconds
      } else {
        item.ttl = 0
      }
      return
    }

    item.x = nextX
    item.y = nextY
  }

  private homeRedShell(item: WorldItem, deltaSeconds: number) {
    const targets = this.hooks
      .getRacers()
      .filter((racer) => racer.id !== item.ownerId)
      .sort((a, b) => {
        const adx = a.x - item.x
        const ady = a.y - item.y
        const bdx = b.x - item.x
        const bdy = b.y - item.y
        return adx * adx + ady * ady - (bdx * bdx + bdy * bdy)
      })

    const target = targets[0]
    if (!target) return

    const speed = Math.hypot(item.vx, item.vy)
    const dx = target.x - item.x
    const dy = target.y - item.y
    const length = Math.max(0.001, Math.hypot(dx, dy))
    const desiredVx = (dx / length) * speed
    const desiredVy = (dy / length) * speed
    const follow = Math.min(1, deltaSeconds * 3.8)
    item.vx = Phaser.Math.Linear(item.vx, desiredVx, follow)
    item.vy = Phaser.Math.Linear(item.vy, desiredVy, follow)
  }

  private checkWorldItemHits(item: WorldItem, camera: Mode7CameraState) {
    const hitRadiusSq = this.worldItemHitRadius * this.worldItemHitRadius

    for (const racer of this.hooks.getRacers()) {
      if (racer.id === item.ownerId && item.ownerGrace > 0) continue
      const dx = racer.x - item.x
      const dy = racer.y - item.y
      if (dx * dx + dy * dy > hitRadiusSq) continue

      if (item.kind === 'coin') {
        this.hooks.addCoin(racer.id, 1)
        this.createCoinPickupVisual(item.x, item.y, camera)
        if (item.trackCoin) {
          const { x, y } = item
          this.scene.time.delayedCall(TRACK_COIN_RESPAWN_MS, () => {
            this.spawnWorldItem(
              'coin',
              'track',
              x,
              y,
              0,
              0,
              Number.POSITIVE_INFINITY,
              0,
              true,
            )
          })
        }
        return true
      }

      if (racer.invulnerable) return true

      this.hooks.spinOutRacer(
        racer.id,
        item.x,
        item.y,
        this.worldScale * PROJECTILE_PUSH_RATIO,
        item.kind === 'banana' ? 0.95 : PROJECTILE_CONTROL_LOCK_SECONDS,
      )
      return true
    }

    return false
  }

  private detonateBomb(item: WorldItem, camera: Mode7CameraState) {
    const radius = this.worldScale * BOMB_BLAST_RADIUS_RATIO
    const radiusSq = radius * radius
    const pushStrength = this.worldScale * BOMB_PUSH_STRENGTH_RATIO

    for (const racer of this.hooks.getRacers()) {
      const dx = racer.x - item.x
      const dy = racer.y - item.y
      if (dx * dx + dy * dy > radiusSq || racer.invulnerable) continue
      this.hooks.spinOutRacer(
        racer.id,
        item.x,
        item.y,
        pushStrength,
        BOMB_CONTROL_LOCK_SECONDS,
      )
    }

    this.createExplosionVisual(item.x, item.y, camera)
  }

  private createExplosionVisual(
    worldX: number,
    worldY: number,
    camera: Mode7CameraState,
  ) {
    const projected = this.renderer.projectWorldPoint(worldX, worldY, camera)
    if (!projected) return

    const baseRadius = Phaser.Math.Clamp(24 * projected.scale, 18, 42)
    const shockwave = this.scene.add
      .circle(projected.x, projected.y, baseRadius, 0xffffff, 0.08)
      .setStrokeStyle(5, 0xfff7cf, 0.95)
      .setDepth(80)

    this.scene.tweens.add({
      targets: shockwave,
      scale: 3.8,
      alpha: 0,
      duration: 520,
      ease: 'Quad.easeOut',
      onComplete: () => shockwave.destroy(),
    })

    for (let index = 0; index < 26; index += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const distance = Phaser.Math.Between(42, 105)
      const spark = this.scene.add
        .rectangle(
          projected.x,
          projected.y,
          Phaser.Math.Between(2, 4),
          Phaser.Math.Between(7, 13),
          index % 3 === 0 ? 0xffffff : 0xffc35a,
          1,
        )
        .setRotation(angle)
        .setDepth(83)

      this.scene.tweens.add({
        targets: spark,
        x: projected.x + Math.cos(angle) * distance,
        y: projected.y + Math.sin(angle) * distance * 0.68,
        alpha: 0,
        scaleY: 0.2,
        duration: Phaser.Math.Between(260, 460),
        ease: 'Quad.easeOut',
        onComplete: () => spark.destroy(),
      })
    }

    for (let index = 0; index < 24; index += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const distance = Phaser.Math.Between(35, 92)
      const debris = this.scene.add
        .rectangle(
          projected.x + Phaser.Math.Between(-5, 5),
          projected.y + Phaser.Math.Between(-4, 4),
          Phaser.Math.Between(3, 8),
          Phaser.Math.Between(3, 8),
          index % 3 === 0 ? 0x5a4433 : 0x2d2926,
          1,
        )
        .setRotation(Phaser.Math.FloatBetween(0, Math.PI))
        .setDepth(82)

      this.scene.tweens.add({
        targets: debris,
        x: projected.x + Math.cos(angle) * distance,
        y: projected.y + Math.sin(angle) * distance * 0.55 + Phaser.Math.Between(8, 28),
        angle: Phaser.Math.Between(-240, 240),
        alpha: 0,
        duration: Phaser.Math.Between(420, 720),
        ease: 'Cubic.easeOut',
        onComplete: () => debris.destroy(),
      })
    }

    for (let index = 0; index < 18; index += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const distance = Phaser.Math.Between(18, 58)
      const smoke = this.scene.add
        .circle(
          projected.x + Math.cos(angle) * 8,
          projected.y + Math.sin(angle) * 5,
          Phaser.Math.Between(6, 12),
          index % 2 === 0 ? 0x665f58 : 0x3c3936,
          0.82,
        )
        .setDepth(81)

      this.scene.tweens.add({
        targets: smoke,
        x: projected.x + Math.cos(angle) * distance,
        y: projected.y + Math.sin(angle) * distance * 0.48 - Phaser.Math.Between(8, 24),
        scale: Phaser.Math.FloatBetween(1.6, 2.5),
        alpha: 0,
        duration: Phaser.Math.Between(620, 900),
        ease: 'Sine.easeOut',
        onComplete: () => smoke.destroy(),
      })
    }
  }

  private createCoinPickupVisual(
    worldX: number,
    worldY: number,
    camera: Mode7CameraState,
  ) {
    const projected = this.renderer.projectWorldPoint(worldX, worldY, camera)
    if (!projected) return

    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2
      const sparkle = this.scene.add
        .circle(projected.x, projected.y, 3, index % 2 === 0 ? 0xffffff : 0xffe34d, 1)
        .setDepth(84)
      this.scene.tweens.add({
        targets: sparkle,
        x: projected.x + Math.cos(angle) * 24,
        y: projected.y + Math.sin(angle) * 18 - 8,
        alpha: 0,
        scale: 0.2,
        duration: 300,
        onComplete: () => sparkle.destroy(),
      })
    }
  }

  private updateWorldItemVisual(item: WorldItem, camera: Mode7CameraState) {
    const projected = this.renderer.projectWorldPoint(item.x, item.y, camera)
    if (!projected) {
      item.image.setVisible(false)
      return
    }

    if (item.frameKeys.length > 1 && item.animationFps > 0) {
      const frameIndex =
        Math.floor((this.scene.time.now / 1000) * item.animationFps) % item.frameKeys.length
      item.image.setTexture(item.frameKeys[frameIndex])
    }

    const scale = Phaser.Math.Clamp(projected.scale, 0.42, 1.75)
    const bob =
      item.kind === 'banana'
        ? 0
        : Math.sin(this.scene.time.now * 0.01 + item.id) * (item.kind === 'coin' ? 2 : 3)
    const sizeMultiplier = item.kind === 'banana' ? 1.15 : item.kind === 'coin' ? 0.92 : 1

    item.image
      .setVisible(true)
      .setPosition(projected.x, projected.y - 7 * scale + bob)
      .setDisplaySize(
        WORLD_ITEM_SIZE * scale * sizeMultiplier,
        WORLD_ITEM_SIZE * scale * sizeMultiplier,
      )
      .setDepth(12 + projected.screenY * 0.01)
      .setRotation(item.kind === 'fireball' ? this.scene.time.now * 0.004 : 0)
  }

  private removeWorldItem(index: number) {
    const [item] = this.worldItems.splice(index, 1)
    item?.image.destroy()
  }

  private registerWorldItemFrames() {
    for (const [kind, config] of Object.entries(WORLD_FRAME_CONFIG) as [
      WorldItemKind,
      WorldFrameConfig,
    ][]) {
      const texture = this.scene.textures.get(config.textureKey)
      const source = texture.getSourceImage() as { width: number; height: number }
      const frameWidth = config.vertical
        ? source.width
        : Math.floor(source.width / config.frameCount)
      const frameHeight = config.vertical
        ? Math.floor(source.height / config.frameCount)
        : source.height
      const standaloneKeys: string[] = []

      for (let index = 0; index < config.frameCount; index += 1) {
        const frameName = `world-${kind}-${index}`
        if (!texture.has(frameName)) {
          texture.add(
            frameName,
            0,
            config.vertical ? 0 : index * frameWidth,
            config.vertical ? index * frameHeight : 0,
            frameWidth,
            frameHeight,
          )
        }

        const key = `retro-kart-${kind}-frame-${index}`
        if (!this.scene.textures.exists(key)) {
          const sourceFrame = texture.get(frameName)
          const canvasTexture = this.scene.textures.createCanvas(
            key,
            sourceFrame.width,
            sourceFrame.height,
          )
          if (canvasTexture) {
            const sourceImage = texture.getSourceImage() as CanvasImageSource
            canvasTexture.context.imageSmoothingEnabled = false
            canvasTexture.context.drawImage(
              sourceImage,
              sourceFrame.cutX,
              sourceFrame.cutY,
              sourceFrame.cutWidth,
              sourceFrame.cutHeight,
              0,
              0,
              sourceFrame.width,
              sourceFrame.height,
            )
            canvasTexture.refresh()
          }
        }
        standaloneKeys.push(key)
      }

      this.worldFrames.set(kind, standaloneKeys)
    }
  }

  private registerRouletteFrames(textureKey: string) {
    const texture = this.scene.textures.get(textureKey)
    for (const frame of ROULETTE_FRAMES) {
      if (texture.has(frame.name)) continue
      texture.add(
        frame.name,
        0,
        frame.x,
        frame.y,
        ROULETTE_FRAME_WIDTH,
        ROULETTE_FRAME_HEIGHT,
      )
    }
  }

  private applyRouletteFrame(index: number) {
    const frame = ROULETTE_FRAMES[index]
    if (frame) this.rouletteSprite.setTexture(this.rouletteTextureKey, frame.name)
  }

  private updateHeldHud() {
    if (!this.heldItem) {
      this.rouletteSprite.setVisible(false)
      this.heldText.setText('')
      return
    }

    this.rouletteSprite
      .setVisible(true)
      .setTexture(
        this.rouletteTextureKey,
        ROULETTE_FRAMES[ROULETTE_FRAME_BY_ITEM[this.heldItem]].name,
      )
      .setScale(ROULETTE_ICON_SCALE)

    this.heldText.setText(`${ITEM_LABELS[this.heldItem]}  [SPACE]`)
  }

  private createPanelTexture() {
    if (this.scene.textures.exists(PANEL_TEXTURE_KEY)) return

    const texture = this.scene.textures.createCanvas(
      PANEL_TEXTURE_KEY,
      PANEL_SIZE * PANEL_FRAME_COUNT,
      PANEL_SIZE,
    )
    if (!texture) return

    const context = texture.context
    context.imageSmoothingEnabled = false

    for (let frame = 0; frame < ACTIVE_PANEL_FRAMES; frame += 1) {
      const frameX = frame * PANEL_SIZE
      this.drawPanelBase(context, frameX, true)
      const glyphX = Math.floor((frame / ACTIVE_PANEL_FRAMES) * PANEL_SIZE)
      context.save()
      context.beginPath()
      context.rect(frameX, 0, PANEL_SIZE, PANEL_SIZE)
      context.clip()
      this.drawQuestionMark(context, frameX + glyphX, 5)
      this.drawQuestionMark(context, frameX + glyphX - PANEL_SIZE, 5)
      context.restore()
    }

    this.drawPanelBase(context, EMPTY_PANEL_FRAME * PANEL_SIZE, false)
    this.drawSadFace(context, EMPTY_PANEL_FRAME * PANEL_SIZE, 0)
    texture.refresh()
  }

  private drawPanelBase(
    context: CanvasRenderingContext2D,
    x: number,
    active: boolean,
  ) {
    context.fillStyle = active ? '#ffc000' : '#d90000'
    context.fillRect(x, 0, PANEL_SIZE, PANEL_SIZE)
    context.fillStyle = active ? '#ffffff' : '#ff9300'
    context.fillRect(x, 0, PANEL_SIZE - 2, 2)
    context.fillRect(x, 0, 2, PANEL_SIZE - 2)
    context.fillStyle = active ? '#9d1400' : '#690000'
    context.fillRect(x, PANEL_SIZE - 2, PANEL_SIZE, 2)
    context.fillRect(x + PANEL_SIZE - 2, 0, 2, PANEL_SIZE)
  }

  private drawQuestionMark(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
  ) {
    context.fillStyle = '#050505'
    const block = 3
    const pixels = [
      [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [4, 1], [3, 2], [4, 2],
      [2, 3], [3, 3], [2, 4], [2, 6],
    ] as const
    for (const [px, py] of pixels) {
      context.fillRect(x + px * block, y + py * block, block, block)
    }
  }

  private drawSadFace(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
  ) {
    context.fillStyle = '#4b0000'
    context.fillRect(x + 8, y + 9, 4, 5)
    context.fillRect(x + 20, y + 9, 4, 5)
    context.fillRect(x + 10, y + 21, 3, 3)
    context.fillRect(x + 13, y + 18, 6, 3)
    context.fillRect(x + 19, y + 21, 3, 3)
  }

  private refreshGroundPanels() {
    const sprites: Mode7GroundSprite[] = this.itemBoxes.map((itemBox) => ({
      x: itemBox.x,
      y: itemBox.y,
      frameX: (itemBox.active ? this.panelFrame : EMPTY_PANEL_FRAME) * PANEL_SIZE,
      frameY: 0,
      frameWidth: PANEL_SIZE,
      frameHeight: PANEL_SIZE,
      worldScale: PANEL_WORLD_SCALE,
    }))
    this.renderer.setGroundSprites(PANEL_TEXTURE_KEY, sprites)
  }
}
