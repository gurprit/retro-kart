import Phaser from 'phaser'
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
  renderer: {
    projectWorldPoint: (
      x: number,
      y: number,
      camera: CameraState,
    ) => { x: number; y: number; screenY: number; scale: number } | undefined
  }
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
        const camera = manager.retroKartLastCamera
        if (!coin || !camera) return
        createGroundCoinBurst(manager, coin.snapshot.x, coin.snapshot.y, camera)
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

function createGroundCoinBurst(
  manager: ManagerInternals,
  worldX: number,
  worldY: number,
  camera: CameraState,
) {
  const projected = manager.renderer.projectWorldPoint(worldX, worldY, camera)
  if (!projected) return

  const scale = Phaser.Math.Clamp(projected.scale, 0.6, 1.7)
  const originX = projected.x
  const groundY = projected.y - 4 * scale
  const depth = 84 + projected.screenY * 0.01

  const ring = manager.scene.add
    .ellipse(originX, groundY, 24 * scale, 8 * scale, 0xffd52a, 0.28)
    .setStrokeStyle(Math.max(2, 3 * scale), 0xffef8a, 0.95)
    .setDepth(depth)

  manager.scene.tweens.add({
    targets: ring,
    scaleX: 4,
    scaleY: 2.4,
    alpha: 0,
    duration: 420,
    ease: 'Quad.easeOut',
    onComplete: () => ring.destroy(),
  })

  for (let index = 0; index < 36; index += 1) {
    const size = Phaser.Math.Between(2, 6) * scale
    const shard = manager.scene.add
      .rectangle(
        originX + Phaser.Math.Between(-7, 7) * scale,
        groundY - Phaser.Math.Between(0, 7) * scale,
        size,
        size * Phaser.Math.FloatBetween(0.65, 1.7),
        index % 4 === 0 ? 0xfff4a3 : index % 2 === 0 ? 0xffd21f : 0xffa000,
        1,
      )
      .setDepth(depth + 2)
      .setRotation(Phaser.Math.FloatBetween(-Math.PI, Math.PI))

    const horizontal = Phaser.Math.Between(-68, 68) * scale
    const landingX = originX + horizontal
    const landingY = groundY + Phaser.Math.Between(-2, 5) * scale
    const apexY = groundY - Phaser.Math.Between(34, 96) * scale

    manager.scene.tweens.add({
      targets: shard,
      x: originX + horizontal * 0.58,
      y: apexY,
      angle: Phaser.Math.Between(-220, 220),
      duration: Phaser.Math.Between(150, 235),
      ease: 'Quad.easeOut',
      onComplete: () => {
        manager.scene.tweens.add({
          targets: shard,
          x: landingX,
          y: landingY,
          duration: Phaser.Math.Between(145, 220),
          ease: 'Quad.easeIn',
          onComplete: () => {
            const bounceHeight = Phaser.Math.Between(8, 23) * scale
            manager.scene.tweens.add({
              targets: shard,
              y: landingY - bounceHeight,
              duration: Phaser.Math.Between(75, 125),
              ease: 'Quad.easeOut',
              yoyo: true,
              onComplete: () => {
                manager.scene.tweens.add({
                  targets: shard,
                  x: shard.x + Phaser.Math.Between(-18, 18) * scale,
                  y: landingY + Phaser.Math.Between(1, 6) * scale,
                  alpha: 0,
                  scaleX: 0.3,
                  scaleY: 0.3,
                  duration: Phaser.Math.Between(220, 390),
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
}
