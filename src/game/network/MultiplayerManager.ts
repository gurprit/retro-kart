import Phaser from 'phaser'
import { Client, type Room } from '@colyseus/sdk'
import type { CpuRacerSnapshot } from '../ai/ComputerRacerManager'
import type { RacerProfile } from '../config/RacerProfiles'
import type { ItemType } from '../items/ItemSystem'
import { Mode7Renderer, type Mode7CameraState } from '../rendering/Mode7Renderer'

const FRAME_WIDTH = 32
const FRAME_HEIGHT = 32
const FRAME_GAP = 1
const FRAME_COUNT = 12
const BASE_SPRITE_HEIGHT = 82
const BACKGROUND_TOLERANCE = 20
const SEND_INTERVAL_SECONDS = 1 / 20
const NETWORK_ITEM_SIZE = 38
const SPIN_FRAME_TIME = 0.05
const HIT_SPIN_LOOPS = 3

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
  spinFrameTimer: number
  spinFrameIndex: number
  shrinkTimer: number
  starTimer: number
  starHue: number
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

export type NetworkHitEffect = {
  ownerId: string
  targetId: string
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

type NetworkLightning = {
  ownerId: string
  targetIds: string[]
  shrinkDurationSeconds: number
  controlLockSeconds: number
}

type NetworkStarActivated = {
  ownerId: string
  durationSeconds: number
}

type NetworkStarHit = NetworkHitEffect & {
  targetType: 'human' | 'cpu'
}

type NetworkCoinSnapshot = {
  id: string
  x: number
  y: number
  active: boolean
}

type NetworkCoin = {
  snapshot: NetworkCoinSnapshot
  image: Phaser.GameObjects.Image
  frameKeys: string[]
  age: number
}

type NetworkCoinPickup = {
  coinId: string
  racerId: string
  targetType: 'human' | 'cpu'
}

export type LocalLightningEffect = {
  shrinkDurationSeconds: number
  controlLockSeconds: number
}

export class MultiplayerManager {
  private readonly scene: Phaser.Scene
  private readonly renderer: Mode7Renderer
  private readonly profilesByKey: Map<string, RacerProfile>
  private readonly remoteRacers = new Map<string, RemoteRacer>()
  private readonly networkItems = new Map<string, NetworkWorldItem>()
  private readonly networkCoins = new Map<string, NetworkCoin>()
  private readonly localHitQueue: NetworkHitEffect[] = []
  private readonly localLightningQueue: LocalLightningEffect[] = []
  private localCoinRewards = 0
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
      room.onMessage('player-joined', (player: KartSnapshot) => this.upsertRemote(player))
      room.onMessage('kart', (player: KartSnapshot) => this.upsertRemote(player))
      room.onMessage('player-left', ({ id }: { id: string }) => this.removeRemote(id))
      room.onMessage('cpus', (snapshots: CpuRacerSnapshot[]) => {
        if (Array.isArray(snapshots)) this.latestCpuSnapshots = snapshots.map((snapshot) => ({ ...snapshot }))
      })
      room.onMessage('item-spawn', (snapshot: NetworkWorldItemSnapshot) => this.upsertNetworkItem(snapshot))
      room.onMessage('items', (snapshots: NetworkWorldItemSnapshot[]) => {
        if (Array.isArray(snapshots)) this.reconcileNetworkItems(snapshots)
      })
      room.onMessage('item-hit', (hit: NetworkItemHit) => this.receiveHit(hit))
      room.onMessage('item-explosion', (explosion: NetworkItemExplosion) => {
        this.createNetworkExplosion(explosion.x, explosion.y)
      })
      room.onMessage('lightning', (event: NetworkLightning) => this.receiveLightning(event))
      room.onMessage('star-activated', (event: NetworkStarActivated) => this.receiveStarActivated(event))
      room.onMessage('star-hit', (hit: NetworkStarHit) => this.receiveHit(hit))
      room.onMessage('coins', (snapshots: NetworkCoinSnapshot[]) => {
        if (Array.isArray(snapshots)) this.reconcileNetworkCoins(snapshots)
      })
      room.onMessage('coin-collected', (pickup: NetworkCoinPickup) => {
        if (pickup.racerId === room.sessionId && pickup.targetType === 'human') this.localCoinRewards += 1
      })
      room.onLeave(() => {
        this.connected = false
        this.room = undefined
        this.latestCpuSnapshots = []
        this.localHitQueue.length = 0
        this.localLightningQueue.length = 0
        this.localCoinRewards = 0
        this.clearRemotes()
        this.clearNetworkItems()
        this.clearNetworkCoins()
      })
      room.onError((code, message) => console.warn('[multiplayer] room error', code, message))

      console.log(
        `[multiplayer] joined ${room.roomId} as ${room.sessionId}; CPUs/items/coins are server-owned`,
      )
    } catch (error) {
      console.warn('[multiplayer] server unavailable; continuing offline', error)
    }
  }

  update(deltaSeconds: number, local: LocalKartState, camera: Mode7CameraState) {
    if (this.connected && this.room) {
      this.sendAccumulator += deltaSeconds
      if (this.sendAccumulator >= SEND_INTERVAL_SECONDS) {
        this.sendAccumulator %= SEND_INTERVAL_SECONDS
        this.room.send('kart', local)
      }
    }

    for (const remote of this.remoteRacers.values()) {
      remote.spinTimer = Math.max(0, remote.spinTimer - deltaSeconds)
      remote.shrinkTimer = Math.max(0, remote.shrinkTimer - deltaSeconds)
      remote.starTimer = Math.max(0, remote.starTimer - deltaSeconds)
      this.updateRemoteSpin(remote, deltaSeconds)
      this.interpolateRemote(remote, deltaSeconds)
      this.updateRemoteSprite(remote, camera)
    }

    this.updateNetworkItems(deltaSeconds, camera)
    this.updateNetworkCoins(deltaSeconds, camera)
  }

  sendItemUse(item: ItemType, local: LocalKartState) {
    if (!this.connected || !this.room) return
    this.room.send('item-use', { item, ...local })
  }

  consumeLocalHits() {
    if (this.localHitQueue.length === 0) return []
    return this.localHitQueue.splice(0, this.localHitQueue.length)
  }

  consumeLocalLightning() {
    if (this.localLightningQueue.length === 0) return []
    return this.localLightningQueue.splice(0, this.localLightningQueue.length)
  }

  consumeLocalCoinRewards() {
    const rewards = this.localCoinRewards
    this.localCoinRewards = 0
    return rewards
  }

  destroy() {
    this.destroyed = true
    this.connected = false
    const room = this.room
    this.room = undefined
    this.latestCpuSnapshots = []
    this.localHitQueue.length = 0
    this.localLightningQueue.length = 0
    this.localCoinRewards = 0
    if (room) void room.leave()
    this.clearRemotes()
    this.clearNetworkItems()
    this.clearNetworkCoins()
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

  private receiveHit(hit: NetworkHitEffect & { targetType?: 'human' | 'cpu' }) {
    if (!hit?.targetId) return
    if (hit.targetId === this.room?.sessionId && hit.targetType !== 'cpu') {
      this.localHitQueue.push({
        ownerId: hit.ownerId,
        targetId: hit.targetId,
        blastX: hit.blastX,
        blastY: hit.blastY,
        pushStrength: hit.pushStrength,
        controlLockSeconds: hit.controlLockSeconds,
      })
      return
    }
    if (hit.targetType === 'human') this.triggerRemoteHit(hit.targetId)
  }

  private receiveLightning(event: NetworkLightning) {
    if (!event?.targetIds) return
    for (const targetId of event.targetIds) {
      if (targetId === this.room?.sessionId) {
        this.localLightningQueue.push({
          shrinkDurationSeconds: event.shrinkDurationSeconds,
          controlLockSeconds: event.controlLockSeconds,
        })
      } else {
        const remote = this.remoteRacers.get(targetId)
        if (!remote) continue
        remote.shrinkTimer = Math.max(remote.shrinkTimer, event.shrinkDurationSeconds)
        this.triggerRemoteHit(targetId)
      }
    }
  }

  private receiveStarActivated(event: NetworkStarActivated) {
    if (!event?.ownerId || event.ownerId === this.room?.sessionId) return
    const remote = this.remoteRacers.get(event.ownerId)
    if (remote) remote.starTimer = Math.max(remote.starTimer, event.durationSeconds)
  }

  private triggerRemoteHit(targetId: string) {
    const remote = this.remoteRacers.get(targetId)
    if (!remote) return
    remote.spinFrameIndex = 0
    remote.spinFrameTimer = 0
    remote.spinTimer = Math.max(
      remote.spinTimer,
      remote.frameKeys.length * SPIN_FRAME_TIME * HIT_SPIN_LOOPS,
    )
  }

  private updateRemoteSpin(remote: RemoteRacer, deltaSeconds: number) {
    if (remote.spinTimer <= 0 || remote.frameKeys.length < 2) return
    remote.spinFrameTimer -= deltaSeconds
    while (remote.spinFrameTimer <= 0 && remote.spinTimer > 0) {
      remote.spinFrameTimer += SPIN_FRAME_TIME
      remote.spinFrameIndex = (remote.spinFrameIndex + 1) % remote.frameKeys.length
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
    if (incoming.ownerId === this.room?.sessionId) return
    const existing = this.networkItems.get(incoming.id)
    if (existing) {
      existing.target = { ...incoming }
      return
    }

    const { frameKeys, animationFps } = this.getItemFrames(incoming.item)
    const textureKey = frameKeys.find((key) => this.scene.textures.exists(key))
    if (!textureKey) return
    const image = this.scene.add.image(-1000, -1000, textureKey)
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
      case 'banana': return { frameKeys: ['retro-kart-banana-world-frame'], animationFps: 0 }
      case 'bomb': return { frameKeys: ['retro-kart-bomb-frame-0'], animationFps: 0 }
      case 'greenShell':
        return {
          frameKeys: [
            'retro-kart-greenShell-frame-0',
            'retro-kart-greenShell-frame-1',
            'retro-kart-greenShell-frame-2',
          ],
          animationFps: 12,
        }
      case 'redShell': return { frameKeys: ['retro-kart-redShell-frame-0'], animationFps: 0 }
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

      const projected = this.renderer.projectWorldPoint(item.snapshot.x, item.snapshot.y, camera)
      if (!projected) {
        item.image.setVisible(false)
        continue
      }
      if (item.frameKeys.length > 1 && item.animationFps > 0) {
        const frameIndex = Math.floor(item.snapshot.age * item.animationFps) % item.frameKeys.length
        item.image.setTexture(item.frameKeys[frameIndex])
      }
      const scale = Phaser.Math.Clamp(projected.scale, 0.42, 1.75)
      const bob = item.snapshot.item === 'banana'
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

  private reconcileNetworkCoins(snapshots: NetworkCoinSnapshot[]) {
    const present = new Set<string>()
    for (const snapshot of snapshots) {
      present.add(snapshot.id)
      const existing = this.networkCoins.get(snapshot.id)
      if (existing) {
        existing.snapshot = { ...snapshot }
        continue
      }
      const frameKeys = [0, 1, 2]
        .map((index) => `retro-kart-coin-frame-${index}`)
        .filter((key) => this.scene.textures.exists(key))
      const textureKey = frameKeys[0]
      if (!textureKey) continue
      this.networkCoins.set(snapshot.id, {
        snapshot: { ...snapshot },
        image: this.scene.add.image(-1000, -1000, textureKey)
          .setOrigin(0.5)
          .setVisible(false)
          .setDepth(13),
        frameKeys,
        age: 0,
      })
    }
    for (const [id, coin] of this.networkCoins) {
      if (present.has(id)) continue
      coin.image.destroy()
      this.networkCoins.delete(id)
    }
  }

  private updateNetworkCoins(deltaSeconds: number, camera: Mode7CameraState) {
    for (const coin of this.networkCoins.values()) {
      coin.age += deltaSeconds
      if (!coin.snapshot.active) {
        coin.image.setVisible(false)
        continue
      }
      const projected = this.renderer.projectWorldPoint(coin.snapshot.x, coin.snapshot.y, camera)
      if (!projected) {
        coin.image.setVisible(false)
        continue
      }
      if (coin.frameKeys.length > 1) {
        const frameIndex = Math.floor(coin.age * 10) % coin.frameKeys.length
        coin.image.setTexture(coin.frameKeys[frameIndex])
      }
      const scale = Phaser.Math.Clamp(projected.scale, 0.42, 1.75)
      coin.image
        .setVisible(true)
        .setPosition(projected.x, projected.y - 8 * scale)
        .setDisplaySize(34 * scale, 34 * scale)
        .setDepth(12 + projected.screenY * 0.01)
    }
  }

  private createNetworkExplosion(worldX: number, worldY: number) {
    const localCamera = (this.scene as Phaser.Scene & { cameraState?: Mode7CameraState }).cameraState
    if (!localCamera) return
    const projected = this.renderer.projectWorldPoint(worldX, worldY, localCamera)
    if (!projected) return

    const ring = this.scene.add.circle(projected.x, projected.y, 20, 0xffffff, 0.08)
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
      const spark = this.scene.add.rectangle(
        projected.x,
        projected.y,
        Phaser.Math.Between(2, 4),
        Phaser.Math.Between(6, 12),
        index % 3 === 0 ? 0xffffff : 0xffc35a,
        1,
      ).setRotation(angle).setDepth(85)
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

  private clearNetworkCoins() {
    for (const coin of this.networkCoins.values()) coin.image.destroy()
    this.networkCoins.clear()
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
    const sprite = this.scene.add.image(-200, -200, frameKeys[0] ?? profile.key)
      .setOrigin(0.5, 1)
      .setVisible(false)
      .setDepth(16)
    this.remoteRacers.set(incoming.id, {
      snapshot: { ...incoming },
      target: { ...incoming },
      sprite,
      frameKeys,
      spinTimer: 0,
      spinFrameTimer: 0,
      spinFrameIndex: 0,
      shrinkTimer: 0,
      starTimer: 0,
      starHue: 0,
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
    remote.snapshot.speedRatio = Phaser.Math.Linear(remote.snapshot.speedRatio, remote.target.speedRatio, amount)
    let difference = remote.target.angle - remote.snapshot.angle
    while (difference > Math.PI) difference -= Math.PI * 2
    while (difference < -Math.PI) difference += Math.PI * 2
    remote.snapshot.angle += difference * amount
  }

  private updateRemoteSprite(remote: RemoteRacer, camera: Mode7CameraState) {
    const projected = this.renderer.projectWorldPoint(remote.snapshot.x, remote.snapshot.y, camera)
    if (!projected) {
      remote.sprite.setVisible(false)
      return
    }

    let relativeAngle = remote.snapshot.angle - camera.angle
    while (relativeAngle > Math.PI) relativeAngle -= Math.PI * 2
    while (relativeAngle < -Math.PI) relativeAngle += Math.PI * 2
    const magnitude = Math.abs(relativeAngle)
    const drivingFrameIndex = magnitude > 0.72 ? 3 : magnitude > 0.42 ? 2 : magnitude > 0.12 ? 1 : 0
    const frameIndex = remote.spinTimer > 0 ? remote.spinFrameIndex : drivingFrameIndex
    const frame = remote.frameKeys[Math.min(frameIndex, remote.frameKeys.length - 1)]
    const shrinkMultiplier = remote.shrinkTimer > 0 ? 0.5 : 1
    const size = Phaser.Math.Clamp(BASE_SPRITE_HEIGHT * projected.scale * shrinkMultiplier, 5, 96)

    remote.sprite
      .setVisible(true)
      .setTexture(frame)
      .setFlipX(remote.spinTimer > 0 ? false : relativeAngle < 0)
      .setPosition(projected.x, projected.y)
      .setDisplaySize(size, size)
      .setDepth(13 + projected.screenY / 1000)
      .setRotation(0)

    if (remote.starTimer > 0) {
      remote.starHue = (remote.starHue + 0.03) % 1
      remote.sprite.setTint(Phaser.Display.Color.HSVToRGB(remote.starHue, 1, 1).color)
    } else {
      remote.sprite.clearTint()
    }
  }

  private createFrames(textureKey: string) {
    const keys: string[] = []
    const texture = this.scene.textures.get(textureKey)
    const source = texture.getSourceImage() as CanvasImageSource & { width: number; height: number }
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
        const frameTexture = this.scene.textures.createCanvas(key, FRAME_WIDTH, FRAME_HEIGHT)
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
            Math.abs(pixels[offset + 2] - b) <= BACKGROUND_TOLERANCE,
      )
      if (isBackground) pixels[offset + 3] = 0
    }
  }

  private pixelAt(pixels: Uint8ClampedArray, x: number, y: number) {
    const offset = (y * FRAME_WIDTH + x) * 4
    return { r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2] }
  }
}
