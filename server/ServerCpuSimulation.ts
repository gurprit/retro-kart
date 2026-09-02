import { RACERS } from '../src/game/config/RacerProfiles'
import { PlayerKart, type KartSurfaceHandling } from '../src/game/entities/PlayerKart'
import type { CpuRacerSnapshot } from '../src/game/ai/ComputerRacerManager'
import { ServerTrackMap, type ServerTrackSurface } from './ServerTrackMap'

const CPU_COUNT = 20

const SURFACE_HANDLING: Record<ServerTrackSurface, KartSurfaceHandling> = {
  road: { speedMultiplier: 1, gripMultiplier: 1, dragMultiplier: 1 },
  offRoad: { speedMultiplier: 0.58, gripMultiplier: 0.7, dragMultiplier: 2.2 },
  barrier: { speedMultiplier: 0.4, gripMultiplier: 0.6, dragMultiplier: 3 },
  void: { speedMultiplier: 0.42, gripMultiplier: 0.55, dragMultiplier: 2.8 },
}

type CpuRacer = {
  id: string
  kart: PlayerKart
  steering: number
  laneBias: number
  skill: number
  pace: number
  recoveryTimer: number
  recoveryForwardTimer: number
  recoverySteering: number
  stuckTimer: number
}

export class ServerCpuSimulation {
  private readonly racers: CpuRacer[] = []
  private readonly worldScale: number

  constructor(
    private readonly track: ServerTrackMap,
    startX: number,
    startY: number,
    startHeading: number,
  ) {
    this.worldScale = Math.min(track.width, track.height)
    const columns = 5
    const columnSpacing = this.worldScale * 0.016
    const rowSpacing = this.worldScale * 0.018

    for (let index = 0; index < CPU_COUNT; index += 1) {
      const row = Math.floor(index / columns)
      const column = index % columns
      const centeredColumn = column - (columns - 1) / 2
      const profile = RACERS[index % RACERS.length]
      const kart = new PlayerKart(
        startX + centeredColumn * columnSpacing,
        startY + (row + 1) * rowSpacing,
        startHeading,
        this.worldScale,
        profile,
      )

      this.racers.push({
        id: `cpu-${index + 1}`,
        kart,
        steering: 0,
        laneBias: this.randomBetween(-0.2, 0.2),
        skill: this.randomBetween(0.55, 0.92),
        pace: this.randomBetween(0.72, 0.9),
        recoveryTimer: 0,
        recoveryForwardTimer: 0,
        recoverySteering: 0,
        stuckTimer: 0,
      })
    }
  }

  update(deltaSeconds: number) {
    for (const racer of this.racers) this.updateDriver(racer, deltaSeconds)
  }

  get snapshots(): CpuRacerSnapshot[] {
    return this.racers.map(({ id, kart, steering }) => ({
      id,
      x: kart.x,
      y: kart.y,
      angle: kart.angle,
      speedRatio: kart.speedRatio,
      steering,
    }))
  }

  get itemStates() {
    return this.racers.map(({ id, kart }) => ({
      id,
      x: kart.x,
      y: kart.y,
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
    this.find(racerId)?.kart.applySpinOut(
      blastX,
      blastY,
      pushStrength,
      controlLockSeconds,
    )
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
      const reverseSteering = -racer.recoverySteering
      racer.steering = this.lerp(racer.steering, reverseSteering, Math.min(1, deltaSeconds * 8))
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
      if (racer.recoveryTimer === 0) racer.recoveryForwardTimer = 0.85
    } else if (racer.recoveryForwardTimer > 0) {
      racer.recoveryForwardTimer = Math.max(0, racer.recoveryForwardTimer - deltaSeconds)
      racer.steering = this.lerp(
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
      if (racer.stuckTimer > 0.95) this.beginRecovery(racer)
      const desiredSteering = this.chooseSteering(racer)
      racer.steering = this.lerp(
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
            canPowerslide && hardCorner &&
            Math.abs(kart.speedRatio) > 0.48 + (1 - racer.skill) * 0.12,
        },
        deltaSeconds,
        handling,
      )
    }

    if (this.track.collidesAlongSegment(previousX, previousY, kart.x, kart.y)) {
      kart.applyCollision(previousX, previousY)
      this.beginRecovery(racer)
    }
  }

  private beginRecovery(racer: CpuRacer) {
    racer.recoverySteering = this.chooseEscapeSteering(racer)
    racer.recoveryTimer = 1.35
    racer.recoveryForwardTimer = 0
    racer.stuckTimer = 0
    racer.laneBias = this.clamp(
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

  private chooseSteering(racer: CpuRacer) {
    const kart = racer.kart
    const speed = this.clamp(Math.abs(kart.speedRatio), 0, 1.2)
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

      score += this.randomBetween(-0.24, 0.24) * (1 - racer.skill)
      if (score > bestScore) {
        bestScore = score
        bestSteering = steering
      }
    }

    return bestSteering
  }

  private cpuHandling(surface: ServerTrackSurface, pace: number): KartSurfaceHandling {
    const base = SURFACE_HANDLING[surface]
    return {
      speedMultiplier: base.speedMultiplier * pace,
      gripMultiplier: base.gripMultiplier,
      dragMultiplier: base.dragMultiplier,
    }
  }

  private find(racerId: string) {
    return this.racers.find((racer) => racer.id === racerId)
  }

  private randomBetween(min: number, max: number) {
    return min + Math.random() * (max - min)
  }

  private lerp(from: number, to: number, amount: number) {
    return from + (to - from) * amount
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
  }
}
