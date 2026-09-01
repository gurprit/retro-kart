import Phaser from 'phaser'
import type { RacerProfile } from '../config/RacerProfiles'
import { PlayerKart, type KartSurfaceHandling } from '../entities/PlayerKart'
import type { ItemRacerState } from '../items/ItemSystem'
import { Mode7Renderer, type Mode7CameraState } from '../rendering/Mode7Renderer'
import { TrackSurfaceMap, type TrackSurface } from '../tracks/TrackSurfaceMap'

const CPU_COUNT = 20
const FRAME_WIDTH = 32
const FRAME_HEIGHT = 32
const FRAME_GAP = 1
const FRAME_COUNT = 5
const BASE_SPRITE_HEIGHT = 82
const BACKGROUND_TOLERANCE = 20

const SURFACE_HANDLING: Record<TrackSurface, KartSurfaceHandling> = {
  road: { speedMultiplier: 1, gripMultiplier: 1, dragMultiplier: 1 },
  offRoad: { speedMultiplier: 0.58, gripMultiplier: 0.7, dragMultiplier: 2.2 },
  barrier: { speedMultiplier: 0.4, gripMultiplier: 0.6, dragMultiplier: 3 },
  void: { speedMultiplier: 0.42, gripMultiplier: 0.55, dragMultiplier: 2.8 },
}

type CpuRacer = {
  id: string
  kart: PlayerKart
  profile: RacerProfile
  sprite: Phaser.GameObjects.Image
  frameKeys: string[]
  steering: number
  laneBias: number
  skill: number
  pace: number
  recoveryTimer: number
  recoveryForwardTimer: number
  recoverySteering: number
  stuckTimer: number
}

export class ComputerRacerManager {
  private readonly scene: Phaser.Scene
  private readonly renderer: Mode7Renderer
  private readonly track: TrackSurfaceMap
  private readonly worldScale: number
  private readonly racers: CpuRacer[] = []

  constructor(
    scene: Phaser.Scene,
    renderer: Mode7Renderer,
    track: TrackSurfaceMap,
    worldScale: number,
    profiles: readonly RacerProfile[],
    startX: number,
    startY: number,
    startHeading: number,
  ) {
    this.scene = scene
    this.renderer = renderer
    this.track = track
    this.worldScale = worldScale

    const columns = 5
    const columnSpacing = worldScale * 0.016
    const rowSpacing = worldScale * 0.018

    for (let index = 0; index < CPU_COUNT; index += 1) {
      const row = Math.floor(index / columns)
      const column = index % columns
      const centeredColumn = column - (columns - 1) / 2
      const profile = profiles[index % profiles.length]
      const id = `cpu-${index + 1}`
      const x = startX + centeredColumn * columnSpacing
      const y = startY + (row + 1) * rowSpacing
      const kart = new PlayerKart(x, y, startHeading, worldScale, profile)
      const frameKeys = this.createFrames(profile.key)
      const sprite = scene.add
        .image(-200, -200, frameKeys[0] ?? profile.key)
        .setOrigin(0.5, 1)
        .setVisible(false)
        .setDepth(15)

      this.racers.push({
        id,
        kart,
        profile,
        sprite,
        frameKeys,
        steering: 0,
        laneBias: Phaser.Math.FloatBetween(-0.2, 0.2),
        skill: Phaser.Math.FloatBetween(0.55, 0.92),
        pace: Phaser.Math.FloatBetween(0.72, 0.9),
        recoveryTimer: 0,
        recoveryForwardTimer: 0,
        recoverySteering: 0,
        stuckTimer: 0,
      })
    }
  }

  update(deltaSeconds: number, camera: Mode7CameraState) {
    for (const racer of this.racers) {
      this.updateDriver(racer, deltaSeconds)
      this.updateSprite(racer, camera)
    }
  }

  destroy() {
    for (const racer of this.racers) racer.sprite.destroy()
    this.racers.length = 0
  }

  get itemStates(): ItemRacerState[] {
    return this.racers.map(({ id, kart }) => ({
      id,
      x: kart.x,
      y: kart.y,
      angle: kart.angle,
      speedRatio: kart.speedRatio,
      invulnerable: kart.isInvulnerable,
    }))
  }

  spinOut(
    racerId: string,
    blastX: number,
    blastY: number,
    pushStrength: number,
    controlLockSeconds: number,
  ) {
    const racer = this.find(racerId)
    racer?.kart.applySpinOut(blastX, blastY, pushStrength, controlLockSeconds)
  }

  boost(racerId: string, multiplier: number, durationSeconds: number) {
    this.find(racerId)?.kart.applyBoost(multiplier, durationSeconds)
  }

  grantStar(racerId: string, durationSeconds: number) {
    this.find(racerId)?.kart.grantStar(durationSeconds)
  }

  addCoin(racerId: string, amount: number) {
    this.find(racerId)?.kart.addCoins(amount)
  }

  private updateDriver(racer: CpuRacer, deltaSeconds: number) {
    const kart = racer.kart
    const surface = this.track.sample(kart.x, kart.y)
    const previousX = kart.x
    const previousY = kart.y
    const handling = this.cpuHandling(surface, racer.pace)

    if (Math.abs(kart.speedRatio) < 0.08) racer.stuckTimer += deltaSeconds
    else racer.stuckTimer = Math.max(0, racer.stuckTimer - deltaSeconds * 2)

    if (racer.recoveryTimer > 0) {
      racer.recoveryTimer = Math.max(0, racer.recoveryTimer - deltaSeconds)

      // Steering is reversed while travelling backwards. Use the opposite
      // control so the kart's nose rotates toward the open-road direction.
      const reverseSteering = -racer.recoverySteering
      racer.steering = Phaser.Math.Linear(racer.steering, reverseSteering, Math.min(1, deltaSeconds * 8))
      kart.update(
        {
          accelerate: false,
          brake: true,
          steerLeft: reverseSteering < -0.08,
          steerRight: reverseSteering > 0.08,
          powerslide: false,
        },
        deltaSeconds,
        handling,
      )

      if (racer.recoveryTimer === 0) {
        racer.recoveryForwardTimer = 0.85
      }
    } else if (racer.recoveryForwardTimer > 0) {
      racer.recoveryForwardTimer = Math.max(0, racer.recoveryForwardTimer - deltaSeconds)
      racer.steering = Phaser.Math.Linear(
        racer.steering,
        racer.recoverySteering,
        Math.min(1, deltaSeconds * 7),
      )
      kart.update(
        {
          accelerate: true,
          brake: false,
          steerLeft: racer.recoverySteering < -0.08,
          steerRight: racer.recoverySteering > 0.08,
          powerslide: false,
        },
        deltaSeconds,
        handling,
      )
    } else {
      if (racer.stuckTimer > 0.95) {
        this.beginRecovery(racer)
      }

      const desiredSteering = this.chooseSteering(racer)
      racer.steering = Phaser.Math.Linear(
        racer.steering,
        desiredSteering,
        Math.min(1, deltaSeconds * (3.4 + racer.skill * 2.2)),
      )

      const hardCorner = Math.abs(racer.steering) > 0.48
      const shouldBrake = hardCorner && Math.abs(kart.speedRatio) > 0.68 + racer.skill * 0.18
      const canPowerslide = racer.skill > 0.7

      kart.update(
        {
          accelerate: !shouldBrake,
          brake: shouldBrake,
          steerLeft: racer.steering < -0.09,
          steerRight: racer.steering > 0.09,
          powerslide:
            canPowerslide &&
            hardCorner &&
            Math.abs(kart.speedRatio) > 0.48 + (1 - racer.skill) * 0.12,
        },
        deltaSeconds,
        handling,
      )
    }

    if (
      this.track.collidesAlongSegment(previousX, previousY, kart.x, kart.y)
    ) {
      kart.applyCollision(previousX, previousY)
      this.beginRecovery(racer)
    }
  }

  private beginRecovery(racer: CpuRacer) {
    racer.recoverySteering = this.chooseEscapeSteering(racer)
    racer.recoveryTimer = 1.35
    racer.recoveryForwardTimer = 0
    racer.stuckTimer = 0
    racer.laneBias = Phaser.Math.Clamp(
      racer.laneBias + racer.recoverySteering * 0.08,
      -0.24,
      0.24,
    )
  }

  private chooseEscapeSteering(racer: CpuRacer) {
    const kart = racer.kart
    const candidates = [-1, -0.7, 0.7, 1]
    const probeDistances = [0.025, 0.05, 0.085, 0.12].map(
      (distance) => this.worldScale * distance,
    )
    let bestSteering = racer.laneBias < 0 ? -1 : 1
    let bestScore = Number.NEGATIVE_INFINITY

    for (const steering of candidates) {
      const probeAngle = kart.angle + steering * 1.05
      const forwardX = Math.sin(probeAngle)
      const forwardY = -Math.cos(probeAngle)
      let score = 0

      for (let index = 0; index < probeDistances.length; index += 1) {
        const distance = probeDistances[index]
        const surface = this.track.sample(
          kart.x + forwardX * distance,
          kart.y + forwardY * distance,
        )
        const weight = index + 1

        if (surface === 'road') score += 5 * weight
        else if (surface === 'offRoad') score += 0.5 * weight
        else if (surface === 'barrier') score -= 9 * weight
        else score -= 11 * weight
      }

      if (score > bestScore) {
        bestScore = score
        bestSteering = steering
      }
    }

    return bestSteering
  }

  private cpuHandling(surface: TrackSurface, pace: number): KartSurfaceHandling {
    const base = SURFACE_HANDLING[surface]
    return {
      speedMultiplier: base.speedMultiplier * pace,
      gripMultiplier: base.gripMultiplier,
      dragMultiplier: base.dragMultiplier,
    }
  }

  private chooseSteering(racer: CpuRacer) {
    const kart = racer.kart
    const speed = Phaser.Math.Clamp(Math.abs(kart.speedRatio), 0, 1.2)
    const probeDistances = [
      this.worldScale * (0.028 + speed * 0.012),
      this.worldScale * (0.052 + speed * 0.02),
      this.worldScale * (0.082 + speed * 0.03),
    ]
    const candidates = [-1, -0.66, -0.33, 0, 0.33, 0.66, 1]
    let bestSteering = 0
    let bestScore = Number.NEGATIVE_INFINITY

    for (const steering of candidates) {
      const angleOffset = steering * 0.88
      const probeAngle = kart.angle + angleOffset
      const rightX = Math.cos(probeAngle)
      const rightY = Math.sin(probeAngle)
      let score = -Math.abs(steering) * 0.32

      for (let index = 0; index < probeDistances.length; index += 1) {
        const distance = probeDistances[index]
        const forwardX = Math.sin(probeAngle)
        const forwardY = -Math.cos(probeAngle)
        const laneOffset = racer.laneBias * this.worldScale * 0.06
        const x = kart.x + forwardX * distance + rightX * laneOffset
        const y = kart.y + forwardY * distance + rightY * laneOffset
        const surface = this.track.sample(x, y)
        const weight = index + 1

        if (surface === 'road') score += 4.2 * weight
        else if (surface === 'offRoad') score -= 1.3 * weight
        else if (surface === 'barrier') score -= 8.5 * weight
        else score -= 10 * weight
      }

      score += Phaser.Math.FloatBetween(-0.24, 0.24) * (1 - racer.skill)
      if (score > bestScore) {
        bestScore = score
        bestSteering = steering
      }
    }

    return bestSteering
  }

  private updateSprite(racer: CpuRacer, camera: Mode7CameraState) {
    const projected = this.renderer.projectWorldPoint(
      racer.kart.x,
      racer.kart.y,
      camera,
    )

    if (!projected) {
      racer.sprite.setVisible(false)
      return
    }

    const size = Phaser.Math.Clamp(BASE_SPRITE_HEIGHT * projected.scale, 10, 96)
    const steeringMagnitude = Math.abs(racer.steering)
    const frameIndex =
      steeringMagnitude > 0.72
        ? 3
        : steeringMagnitude > 0.42
          ? 2
          : steeringMagnitude > 0.1
            ? 1
            : 0
    const frame = racer.frameKeys[Math.min(frameIndex, racer.frameKeys.length - 1)]

    racer.sprite
      .setVisible(true)
      .setTexture(frame ?? racer.profile.key)
      .setFlipX(racer.steering < 0)
      .setPosition(projected.x, projected.y)
      .setDisplaySize(size, size)
      .setDepth(12 + projected.screenY / 1000)
  }

  private find(racerId: string) {
    return this.racers.find((racer) => racer.id === racerId)
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
      const key = `cpu-racer-${textureKey}-${index}`
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
