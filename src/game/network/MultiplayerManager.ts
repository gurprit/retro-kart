import Phaser from 'phaser'
import { Client, type Room } from '@colyseus/sdk'
import type { CpuRacerSnapshot } from '../ai/ComputerRacerManager'
import type { RacerProfile } from '../config/RacerProfiles'
import { Mode7Renderer, type Mode7CameraState } from '../rendering/Mode7Renderer'

const FRAME_WIDTH = 32
const FRAME_HEIGHT = 32
const FRAME_GAP = 1
const FRAME_COUNT = 5
const BASE_SPRITE_HEIGHT = 82
const BACKGROUND_TOLERANCE = 20
const SEND_INTERVAL_SECONDS = 1 / 20

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
}

export class MultiplayerManager {
  private readonly scene: Phaser.Scene
  private readonly renderer: Mode7Renderer
  private readonly profilesByKey: Map<string, RacerProfile>
  private readonly remoteRacers = new Map<string, RemoteRacer>()
  private room?: Room
  private sendAccumulator = 0
  private connected = false
  private destroyed = false
  private simulationHostId?: string
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
      room.onMessage('simulation-host', ({ id }: { id: string | null }) => {
        this.simulationHostId = id ?? undefined
        console.log(
          `[multiplayer] CPU simulation ${this.isSimulationHost ? 'HOST' : 'CLIENT'}`,
        )
      })
      room.onMessage('cpus', (snapshots: CpuRacerSnapshot[]) => {
        if (!Array.isArray(snapshots)) return
        this.latestCpuSnapshots = snapshots.map((snapshot) => ({ ...snapshot }))
      })
      room.onLeave(() => {
        this.connected = false
        this.room = undefined
        this.simulationHostId = undefined
        this.latestCpuSnapshots = []
        this.clearRemotes()
      })
      room.onError((code, message) => {
        console.warn('[multiplayer] room error', code, message)
      })

      console.log(`[multiplayer] joined ${room.roomId} as ${room.sessionId}`)
    } catch (error) {
      console.warn('[multiplayer] server unavailable; continuing offline', error)
    }
  }

  update(
    deltaSeconds: number,
    local: LocalKartState,
    camera: Mode7CameraState,
    cpuSnapshots: readonly CpuRacerSnapshot[] = [],
  ) {
    if (this.connected && this.room) {
      this.sendAccumulator += deltaSeconds
      if (this.sendAccumulator >= SEND_INTERVAL_SECONDS) {
        this.sendAccumulator %= SEND_INTERVAL_SECONDS
        this.room.send('kart', local)
        if (this.isSimulationHost && cpuSnapshots.length > 0) {
          this.room.send('cpus', cpuSnapshots)
        }
      }
    }

    for (const remote of this.remoteRacers.values()) {
      this.interpolateRemote(remote, deltaSeconds)
      this.updateRemoteSprite(remote, camera)
    }
  }

  destroy() {
    this.destroyed = true
    this.connected = false
    const room = this.room
    this.room = undefined
    this.simulationHostId = undefined
    this.latestCpuSnapshots = []
    if (room) void room.leave()
    this.clearRemotes()
  }

  get remoteCount() {
    return this.remoteRacers.size
  }

  get isSimulationHost() {
    return Boolean(
      this.connected &&
        this.room &&
        this.simulationHostId === this.room.sessionId,
    )
  }

  get shouldSimulateCpus() {
    return !this.connected || this.isSimulationHost
  }

  get cpuSnapshots(): readonly CpuRacerSnapshot[] {
    return this.latestCpuSnapshots
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
