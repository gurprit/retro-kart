import Phaser from 'phaser'
import { COIN_WORLD_BURST_EVENT } from '../items/installWorldPickupParticles'
import { MultiplayerManager } from './MultiplayerManager'

const FEATHER_JUMP_DURATION_MS = 680
const FEATHER_JUMP_HEIGHT = 78

type CameraState = unknown

type RemoteState = {
  sprite: Phaser.GameObjects.Image
  frameKeys: string[]
  spinTimer: number
  spinFrameTimer: number
  spinFrameIndex: number
  featherStartedAt?: number
  featherUntil?: number
}

type CoinState = {
  snapshot: { x: number; y: number }
  image: Phaser.GameObjects.Image
}

type ManagerInternals = {
  scene: Phaser.Scene
  room?: {
    sessionId: string
    onMessage: (type: string, callback: (payload: any) => void) => unknown
  }
  remoteRacers: Map<string, RemoteState>
  networkCoins: Map<string, CoinState>
  retroKartLastCamera?: CameraState
}

let installed = false

export function installSharedItemEffects() {
  if (installed) return
  installed = true

  const prototype = MultiplayerManager.prototype as unknown as {
    connect: (...args: any[]) => Promise<void>
    update: (deltaSeconds: number, local: unknown, camera: CameraState) => void
    updateRemoteSprite: (remote: RemoteState, camera: CameraState) => void
  }

  const originalConnect = prototype.connect
  prototype.connect = async function (this: MultiplayerManager, ...args: any[]) {
    await originalConnect.apply(this, args)
    const manager = this as unknown as ManagerInternals
    const room = manager.room
    if (!room) return

    room.onMessage('feather-activated', (event: { ownerId?: string }) => {
      if (!event?.ownerId || event.ownerId === room.sessionId) return
      const remote = manager.remoteRacers.get(event.ownerId)
      if (!remote) return
      const now = manager.scene.time.now
      remote.featherStartedAt = now
      remote.featherUntil = now + FEATHER_JUMP_DURATION_MS
      remote.spinFrameIndex = 0
      remote.spinFrameTimer = 0
      remote.spinTimer = FEATHER_JUMP_DURATION_MS / 1000
    })

    room.onMessage(
      'coin-collected',
      (pickup: { coinId?: string; racerId?: string; targetType?: string }) => {
        if (!pickup?.coinId) return
        const coin = manager.networkCoins.get(pickup.coinId)
        if (!coin) return

        manager.scene.events.emit(COIN_WORLD_BURST_EVENT, {
          x: coin.snapshot.x,
          y: coin.snapshot.y,
        })
      },
    )
  }

  const originalUpdate = prototype.update
  prototype.update = function (
    this: MultiplayerManager,
    deltaSeconds: number,
    local: unknown,
    camera: CameraState,
  ) {
    ;(this as unknown as ManagerInternals).retroKartLastCamera = camera
    originalUpdate.call(this, deltaSeconds, local, camera)
  }

  const originalUpdateRemoteSprite = prototype.updateRemoteSprite
  prototype.updateRemoteSprite = function (
    this: MultiplayerManager,
    remote: RemoteState,
    camera: CameraState,
  ) {
    originalUpdateRemoteSprite.call(this, remote, camera)
    const manager = this as unknown as ManagerInternals
    const now = manager.scene.time.now
    if (!remote.featherUntil || !remote.featherStartedAt || now >= remote.featherUntil) return

    const progress = Phaser.Math.Clamp(
      (now - remote.featherStartedAt) / FEATHER_JUMP_DURATION_MS,
      0,
      1,
    )
    const lift = Math.sin(progress * Math.PI) * FEATHER_JUMP_HEIGHT
    remote.sprite.setY(remote.sprite.y - lift)
  }
}
