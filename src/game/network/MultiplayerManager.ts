import Phaser from 'phaser'
import { Client, type Room } from '@colyseus/sdk'
import type { CpuRacerSnapshot } from '../ai/ComputerRacerManager'
import type { RacerProfile } from '../config/RacerProfiles'
import type { ItemType } from '../items/ItemSystem'
import { Mode7Renderer, type Mode7CameraState } from '../rendering/Mode7Renderer'

const FRAME_WIDTH = 32
const FRAME_HEIGHT = 32
const FRAME_GAP = 1
const FRAME_COUNT = 5
const BASE_SPRITE_HEIGHT = 82
const BACKGROUND_TOLERANCE = 20
const SEND_INTERVAL_SECONDS = 1 / 20
const NETWORK_ITEM_SIZE = 38

type KartSnapshot = {
  id: string
  racerKey: string
  x: number
  y: number
  angle: number
  speedRatio: number
}

type LocalKartState = Omit<KartSnapshot, 'id' | 'racerKey'>

type RemoteRacer = {
  snapshot: KartSnapshot
  target: KartSnapshot
  sprite: Phaser.GameObjects.Image
  frameKeys: string[]
  spinTimer: number
}

type NetworkWorldItemKind =
  | 'banana'
  | 'bomb'
  | 'fireball'
  | 'greenShell'
  | 'redShell'

type NetworkWorldItemSnapshot = {
  id: string
  item: NetworkWorldItemKind
  ownerId: string
  x: number
  y: number
  vx: number
  vy: number
  ttl: number
  age: number
}

type NetworkWorldItem = {
  snapshot: NetworkWorldItemSnapshot
  target: NetworkWorldItemSnapshot
  image: Phaser.GameObjects.Image
  frameKeys: string[]
  animationFps: number
}

export type NetworkItemHit = {
  itemId: string
  item: NetworkWorldItemKind
  ownerId: string
  targetId: string
  targetType: 'human' | 'cpu'
  blastX: number
  blastY: number
  pushStrength: number
  controlLockSeconds: number
}

type NetworkItemExplosion = {
  itemId: string
  x: number
  y: number
}

export class MultiplayerManager {
  private readonly scene: Phaser.Scene
  private readonly renderer: Mode7Renderer
  private readonly profilesByKey: Map<string, RacerProfile>
  private readonly remoteRacers = new Map<string, RemoteRacer>()
  private readonly networkItems = new Map<string, NetworkWorldItem>()
  private readonly localHitQueue: NetworkItemHit[] = []
  private room?: Room
  private sendAccumulator = 0
  private connected = false
  private destroyed = false
  private latestCpuSnapshots: CpuRacerSnapshot[] = []

  constructor(
    scene: Phaser.Scene,
    renderer: Mode7Renderer,
    profiles: readonly RacerProfile[],
  ) {
    this.scene = scene
    this.renderer = renderer
    this.profilesByKey = new Map(profiles.map((profile) => [profile.key, profile]))
  }

  async connect(racerKey: string, initial: LocalKartState) {
    if (this.destroyed || this.room) return

    const explicitEndpoint = import.meta.env.VITE_COLYSEUS_URL as string | undefined
    const endpoint =
      explicitEndpoint?.trim() ||
      `${window.location.protocol}//${window.location.hostname}:2567`

    try {
      const client = new Client(endpoint)
      const room = await client.joinOrCreate('retro_kart', {
        racerKey,
        x: initial.x,
        y: initial.y,
        angle: initial.angle,
      })

      if (this.destroyed) {
        void room.leave()
        return
      }

      this.room = room
      this.connected = true

      room.onMessage('players', (players: KartSnapshot[]) => {
        for (const player of players) this.upsertRemote(player)
      })
      room.onMessage('player-joined', (player: KartSnapshot) => {
        this.upsertRemote(player)
      })
      room.onMessage('kart', (player: KartSnapshot) => {
        this.upsertRemote(player)
      })
      room.onMessage('player-left', ({ id }: { id: string }) => {
        this.removeRemote(id)
      })
      room.onMessage('cpus', (snapshots: CpuRacerSnapshot[]) => {
        if (!Array.isArray(snapshots)) return
        this.latestCpuSnapshots = snapshots.map((snapshot) => ({ ...snapshot }))
      })
      room.onMessage('item-spawn', (snapshot: NetworkWorldItemSnapshot) => {
        this.upsertNetworkItem(snapshot)
      })
      room.onMessage('items', (snapshots: NetworkWorldItemSnapshot[]) => {
        if (!Array.isArray(snapshots)) return
        this.reconcileNetworkItems(snapshots)
      })
      room.onMessage('item-hit', (hit: NetworkItemHit) => {
        this.receiveItemHit(hit)
      })
      room.onMessage('item-explosion', (explosion: NetworkItemExplosion) => {
        this.createNetworkExplosion(explosion.x, explosion.y)
      })
      room.onLeave(() => {
        this.connected = false
        this.room = undefined
        this.latestCpuSnapshots = []
        this.localHitQueue.length = 0
        this.clearRemotes()
        this.clearNetworkItems()
      })
      room.onError((code, message) => {
        console.warn('[multiplayer] room error', code, message)
      })

      console.log(
        `[multiplayer] joined ${room.roomId} as ${room.sessionId}; CPUs/items are server-owned`,
      )
    } catch (error) {
      console.warn('[multiplayer] server unavailable; continuing offline', error)
    }
  }

  update(
    deltaSeconds: number,
    local: LocalKartState,
    camera: Mode7CameraState,
  ) {
    if (this.connected && this.room) {
      this.sendAccumulator += deltaSeconds
      if (this.sendAccumulator >= SEND_INTERVAL_SECONDS) {
        this.sendAccumulator %= SEND_INTERVAL_SECONDS
        this.room.send('kart', local)
      }
    }

    for (const remote of this.remoteRacers.values()) {
      remote.spinTimer = Math.max(0, remote.spinTimer - deltaSeconds)
      this.interpolateRemote(remote, deltaSeconds)
      this.updateRemoteSprite(remote, camera)
    }

    this.updateNetworkItems(deltaSeconds, camera)
  }

  sendItemUse(item: ItemType, local: LocalKartState) {
    if (!this.connected || !this.room) return
    this.room.send('item-use', {
      item,
      x: local.x,
      y: local.y,
      angle: local.angle,
      speedRatio: local.speedRatio,
    })
  }

  consumeLocalHits() {
    if (this.localHitQueue.length === 0) return []
    return this.localHitQueue.splice(0, this.localHitQueue.length)
  }

  destroy() {
    this.destroyed = true
    this.connected = false
    const room = this.room
    this.room = undefined
    this.latestCpuSnapshots = []
    this.localHitQueue.length = 0
    if (room) void room.leave()
    this.clearRemotes()
    this.clearNetworkItems()
  }

  get remoteCount() {
    return this.remoteRacers.size
  }

  get isConnected() {
    return this.connected
  }

  get shouldSimulateCpus() {
    return !this.connected
  }

  get cpuSource() {
    return this.connected ? 'SERVER' : 'LOCAL'
  }

  get cpuSnapshots(): readonly CpuRacerSnapshot[] {
    return this.latestCpuSnapshots
  }

  private receiveItemHit(hit: NetworkItemHit) {
    if (!hit?.targetId) return

    if (hit.targetId === this.room?.sessionId && hit.targetType === 'human') {
      this.localHitQueue.push({ ...hit })
      return
    }

    if (hit.targetType === 'human') {
      const remote = this.remoteRacers.get(hit.targetId)
      if (remote) remote.spinTimer = Math.max(remote.spinTimer, hit.controlLockSeconds)
    }
  }

  private reconcileNetworkItems(snapshots: NetworkWorldItemSnapshot[]) {
    const present = new Set<string>()
    for (const snapshot of snapshots) {
      present.add(snapshot.id)
      this.upsertNetworkItem(snapshot)
    }

    for (const [id, item] of this.networkItems) {
      if (present.has(id)) continue
      item.image.destroy()
      this.networkItems.delete(id)
    }
  }

  private upsertNetworkItem(incoming: NetworkWorldItemSnapshot) {
    if (!incoming?.id) return

    // The firing client already renders its own locally-simulated item. Other
    // clients render the authoritative server copy, avoiding a doubled sprite
    // while we preserve the existing offline ItemSystem behaviour.
    if (incoming.ownerId === this.room?.sessionId) return

    const existing = this.networkItems.get(incoming.id)
    if (existing) {
      existing.target = { ...incoming }
      return
    }

    const { frameKeys, animationFps } = this.getItemFrames(incoming.item)
    const textureKey = frameKeys.find((key) => this.scene.textures.exists(key))
    if (!textureKey) return

    const image = this.scene.add
      .image(-1000, -1000, textureKey)
      .setOrigin(0.5)
      .setVisible(false)
      .setDepth(14)

    this.networkItems.set(incoming.id, {
      snapshot: { ...incoming },
      target: { ...incoming },
      image,
      frameKeys: frameKeys.filter((key) => this.scene.textures.exists(key)),
      animationFps,
    })
  }

  private getItemFrames(item: NetworkWorldItemKind) {
    switch (item) {
      case 'banana':
        return { frameKeys: ['retro-kart-banana-world-frame'], animationFps: 0 }
      case 'bomb':
        return { frameKeys: ['retro-kart-bomb-frame-0'], animationFps: 0 }
      case 'greenShell':
        return {
          frameKeys: [
            'retro-kart-greenShell-frame-0',
            'retro-kart-greenShell-frame-1',
            'retro-kart-greenShell-frame-2',
          ],
          animationFps: 12,
        }
      case 'redShell':
        return { frameKeys: ['retro-kart-redShell-frame-0'], animationFps: 0 }
      case 'fireball':
        return {
          frameKeys: [
            'retro-kart-fireball-frame-0',
            'retro-kart-fireball-frame-1',
            'retro-kart-fireball-frame-2',
            'retro-kart-fireball-frame-3',
            'retro-kart-fireball-frame-4',
          ],
          animationFps: 15,
        }
    }
  }

  private updateNetworkItems(deltaSeconds: number, camera: Mode7CameraState) {
    const amount = 1 - Math.exp(-18 * deltaSeconds)

    for (const item of this.networkItems.values()) {
      item.snapshot.x = Phaser.Math.Linear(item.snapshot.x, item.target.x, amount)
      item.snapshot.y = Phaser.Math.Linear(item.snapshot.y, item.target.y, amount)
      item.snapshot.vx = Phaser.Math.Linear(item.snapshot.vx, item.target.vx, amount)
      item.snapshot.vy = Phaser.Math.Linear(item.snapshot.vy, item.target.vy, amount)
      item.snapshot.ttl = item.target.ttl
      item.snapshot.age = item.target.age

      const projected = this.renderer.projectWorldPoint(
        item.snapshot.x,
        item.snapshot.y,
        camera,
      )
      if (!projected) {
        item.image.setVisible(false)
        continue
      }

      if (item.frameKeys.length > 1 && item.animationFps > 0) {
        const frameIndex =
          Math.floor(item.snapshot.age * item.animationFps) % item.frameKeys.length
        item.image.setTexture(item.frameKeys[frameIndex])
      }

      const scale = Phaser.Math.Clamp(projected.scale, 0.42, 1.75)
      const bob =
        item.snapshot.item === 'banana'
          ? 0
          : Math.sin(this.scene.time.now * 0.01 + item.snapshot.age * 4) * 3
      const sizeMultiplier = item.snapshot.item === 'banana' ? 1.45 : 1

      item.image
        .setVisible(true)
        .setPosition(projected.x, projected.y - 7 * scale + bob)
        .setDisplaySize(
          NETWORK_ITEM_SIZE * scale * sizeMultiplier,
          NETWORK_ITEM_SIZE * scale * sizeMultiplier,
        )
        .setDepth(12 + projected.screenY * 0.01)
        .setRotation(item.snapshot.item === 'fireball' ? this.scene.time.now * 0.004 : 0)
    }
  }

  private createNetworkExplosion(worldX: number, worldY: number) {
    const camera = this.scene.cameras.main
    void camera

    // Projection uses the most recent RaceScene camera during the next update.
    // Store a short-lived marker and render immediately from the currently
    // visible world item location when possible.
    const localCamera = (this.scene as Phaser.Scene & {
      cameraState?: Mode7CameraState
    }).cameraState
    if (!localCamera) return

    const projected = this.renderer.projectWorldPoint(worldX, worldY, localCamera)
    if (!projected) return

    const ring = this.scene.add
      .circle(projected.x, projected.y, 20, 0xffffff, 0.08)
      .setStrokeStyle(5, 0xfff0b0, 0.95)
      .setDepth(84)

    this.scene.tweens.add({
      targets: ring,
      scale: 3.5,
      alpha: 0,
      duration: 500,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    })

    for (let index = 0; index < 18; index += 1) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2)
      const distance = Phaser.Math.Between(30, 90)
      const spark = this.scene.add
        .rectangle(
          projected.x,
          projected.y,
          Phaser.Math.Between(2, 4),
          Phaser.Math.Between(6, 12),
          index % 3 === 0 ? 0xffffff : 0xffc35a,
          1,
        )
        .setRotation(angle)
        .setDepth(85)

      this.scene.tweens.add({
        targets: spark,
        x: projected.x + Math.cos(angle) * distance,
        y: projected.y + Math.sin(angle) * distance * 0.65,
        alpha: 0,
        duration: Phaser.Math.Between(260, 480),
        onComplete: () => spark.destroy(),
      })
    }
  }

  private clearNetworkItems() {
    for (const item of this.networkItems.values()) item.image.destroy()
    this.networkItems.clear()
  }

  private upsertRemote(incoming: KartSnapshot) {
    if (!incoming?.id || incoming.id === this.room?.sessionId) return
    const profile = this.profilesByKey.get(incoming.racerKey)
    if (!profile) return

    const existing = this.remoteRacers.get(incoming.id)
    if (existing) {
      existing.target = { ...incoming }
      return
    }

    const frameKeys = this.createFrames(profile.key)
    const sprite = this.scene.add
      .image(-200, -200, frameKeys[0] ?? profile.key)
      .setOrigin(0.5, 1)
      .setVisible(false)
      .setDepth(16)

    this.remoteRacers.set(incoming.id, {
      snapshot: { ...incoming },
      target: { ...incoming },
      sprite,
      frameKeys,
      spinTimer: 0,
    })
  }

  private removeRemote(id: string) {
    const remote = this.remoteRacers.get(id)
    remote?.sprite.destroy()
    this.remoteRacers.delete(id)
  }

  private clearRemotes() {
    for (const remote of this.remoteRacers.values()) remote.sprite.destroy()
    this.remoteRacers.clear()
  }

  private interpolateRemote(remote: RemoteRacer, deltaSeconds: number) {
    const amount = 1 - Math.exp(-12 * deltaSeconds)
    remote.snapshot.x = Phaser.Math.Linear(remote.snapshot.x, remote.target.x, amount)
    remote.snapshot.y = Phaser.Math.Linear(remote.snapshot.y, remote.target.y, amount)
    remote.snapshot.speedRatio = Phaser.Math.Linear(
      remote.snapshot.speedRatio,
      remote.target.speedRatio,
      amount,
    )

    let difference = remote.target.angle - remote.snapshot.angle
    while (difference > Math.PI) difference -= Math.PI * 2
    while (difference < -Math.PI) difference += Math.PI * 2
    remote.snapshot.angle += difference * amount
  }

  private updateRemoteSprite(remote: RemoteRacer, camera: Mode7CameraState) {
    const projected = this.renderer.projectWorldPoint(
      remote.snapshot.x,
      remote.snapshot.y,
      camera,
    )

    if (!projected) {
      remote.sprite.setVisible(false)
      return
    }

    let relativeAngle = remote.snapshot.angle - camera.angle
    while (relativeAngle > Math.PI) relativeAngle -= Math.PI * 2
    while (relativeAngle < -Math.PI) relativeAngle += Math.PI * 2

    const magnitude = Math.abs(relativeAngle)
    const frameIndex =
      magnitude > 0.72 ? 3 : magnitude > 0.42 ? 2 : magnitude > 0.12 ? 1 : 0
    const size = Phaser.Math.Clamp(BASE_SPRITE_HEIGHT * projected.scale, 10, 96)
    const frame = remote.frameKeys[Math.min(frameIndex, remote.frameKeys.length - 1)]

    remote.sprite
      .setVisible(true)
      .setTexture(frame)
      .setFlipX(relativeAngle < 0)
      .setPosition(projected.x, projected.y)
      .setDisplaySize(size, size)
      .setDepth(13 + projected.screenY / 1000)
      .setRotation(
        remote.spinTimer > 0
          ? this.scene.time.now * 0.018
          : 0,
      )
  }

  private createFrames(textureKey: string) {
    const keys: string[] = []
    const texture = this.scene.textures.get(textureKey)
    const source = texture.getSourceImage() as CanvasImageSource & {
      width: number
      height: number
    }
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return keys

    context.imageSmoothingEnabled = false
    context.drawImage(source, 0, 0)
    const availableFrames = Math.min(
      FRAME_COUNT,
      Math.floor((source.width + FRAME_GAP) / (FRAME_WIDTH + FRAME_GAP)),
    )

    for (let index = 0; index < availableFrames; index += 1) {
      const key = `remote-racer-${textureKey}-${index}`
      if (!this.scene.textures.exists(key)) {
        const x = index * (FRAME_WIDTH + FRAME_GAP)
        const imageData = context.getImageData(x, 0, FRAME_WIDTH, FRAME_HEIGHT)
        this.removeFrameBackground(imageData)
        const frameTexture = this.scene.textures.createCanvas(
          key,
          FRAME_WIDTH,
          FRAME_HEIGHT,
        )
        if (frameTexture) {
          frameTexture.context.imageSmoothingEnabled = false
          frameTexture.context.putImageData(imageData, 0, 0)
          frameTexture.refresh()
        }
      }
      keys.push(key)
    }

    return keys
  }

  private removeFrameBackground(imageData: ImageData) {
    const pixels = imageData.data
    const corners = [
      this.pixelAt(pixels, 0, 0),
      this.pixelAt(pixels, FRAME_WIDTH - 1, 0),
      this.pixelAt(pixels, 0, FRAME_HEIGHT - 1),
      this.pixelAt(pixels, FRAME_WIDTH - 1, FRAME_HEIGHT - 1),
    ]

    for (let offset = 0; offset < pixels.length; offset += 4) {
      const isBackground = corners.some(
        ({ r, g, b }) =>
          Math.abs(pixels[offset] - r) +
            Math.abs(pixels[offset + 1] - g) +
            Math.abs(pixels[offset + 2] - b) <=
          BACKGROUND_TOLERANCE,
      )
      if (isBackground) pixels[offset + 3] = 0
    }
  }

  private pixelAt(pixels: Uint8ClampedArray, x: number, y: number) {
    const offset = (y * FRAME_WIDTH + x) * 4
    return {
      r: pixels[offset],
      g: pixels[offset + 1],
      b: pixels[offset + 2],
    }
  }
}
