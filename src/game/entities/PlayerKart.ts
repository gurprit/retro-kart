import type { RacerProfile } from '../config/RacerProfiles'

export type KartControls = {
  accelerate: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
  powerslide: boolean
}

export type KartSurfaceHandling = {
  speedMultiplier: number
  gripMultiplier: number
  dragMultiplier: number
}

export type KartState = 'normal' | 'powerslide' | 'hit'

const DEFAULT_SURFACE: KartSurfaceHandling = {
  speedMultiplier: 1,
  gripMultiplier: 1,
  dragMultiplier: 1,
}

const POWERSLIDE_MIN_SPEED_RATIO = 0.22
const POWERSLIDE_TURN_MULTIPLIER = 1.55
const POWERSLIDE_TRAVEL_FOLLOW = 3.2
const NORMAL_TRAVEL_FOLLOW = 12
const COLLISION_BOUNCE = 0.28
const COLLISION_HIT_TIME = 0.12

export class PlayerKart {
  x: number
  y: number
  angle: number
  speed = 0
  state: KartState = 'normal'

  readonly maxForwardSpeed: number
  readonly maxReverseSpeed: number
  readonly racerProfile: RacerProfile

  private readonly acceleration: number
  private readonly braking: number
  private readonly reverseAcceleration: number
  private readonly rollingResistance: number
  private readonly turnRate: number
  private travelAngle: number
  private hitTimer = 0

  constructor(
    x: number,
    y: number,
    angle: number,
    worldScale: number,
    racerProfile: RacerProfile,
  ) {
    this.x = x
    this.y = y
    this.angle = angle
    this.travelAngle = angle
    this.racerProfile = racerProfile

    const baseForwardSpeed = worldScale * 0.32
    this.maxForwardSpeed =
      baseForwardSpeed * racerProfile.topSpeedMultiplier
    this.maxReverseSpeed = this.maxForwardSpeed * 0.34
    this.acceleration =
      baseForwardSpeed * 0.82 * racerProfile.accelerationMultiplier
    this.braking = baseForwardSpeed * 1.55
    this.reverseAcceleration = baseForwardSpeed * 0.56
    this.rollingResistance = baseForwardSpeed * 0.42
    this.turnRate = 2.15
  }

  update(
    controls: KartControls,
    deltaSeconds: number,
    surface: KartSurfaceHandling = DEFAULT_SURFACE,
  ) {
    this.hitTimer = Math.max(0, this.hitTimer - deltaSeconds)

    const canPowerslide =
      controls.powerslide &&
      (controls.steerLeft || controls.steerRight) &&
      Math.abs(this.speedRatio) >= POWERSLIDE_MIN_SPEED_RATIO &&
      this.hitTimer === 0

    this.state = this.hitTimer > 0 ? 'hit' : canPowerslide ? 'powerslide' : 'normal'

    this.updateSpeed(controls, deltaSeconds, surface)
    this.updateSteering(controls, deltaSeconds, surface, canPowerslide)
    this.updateTravelAngle(deltaSeconds, canPowerslide)

    const distance = this.speed * deltaSeconds
    this.x += Math.sin(this.travelAngle) * distance
    this.y -= Math.cos(this.travelAngle) * distance
  }

  get speedRatio() {
    return this.speed / this.maxForwardSpeed
  }

  applyCollision(x: number, y: number) {
    this.x = x
    this.y = y
    this.speed = -this.speed * COLLISION_BOUNCE
    this.travelAngle = this.angle
    this.hitTimer = COLLISION_HIT_TIME
    this.state = 'hit'
  }

  private updateSpeed(
    controls: KartControls,
    deltaSeconds: number,
    surface: KartSurfaceHandling,
  ) {
    const forwardLimit = this.maxForwardSpeed * surface.speedMultiplier
    const reverseLimit = this.maxReverseSpeed * surface.speedMultiplier

    if (controls.accelerate) {
      if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + this.braking * deltaSeconds)
      } else {
        this.speed = Math.min(
          forwardLimit,
          this.speed + this.acceleration * deltaSeconds,
        )
      }
    } else if (controls.brake) {
      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - this.braking * deltaSeconds)
      } else {
        this.speed = Math.max(
          -reverseLimit,
          this.speed - this.reverseAcceleration * deltaSeconds,
        )
      }
    } else {
      const resistance =
        this.rollingResistance * surface.dragMultiplier * deltaSeconds

      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - resistance)
      } else if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + resistance)
      }
    }

    if (this.speed > forwardLimit) {
      const excess = this.speed - forwardLimit
      const slowdown =
        this.rollingResistance * surface.dragMultiplier * 2.2 * deltaSeconds
      this.speed = forwardLimit + Math.max(0, excess - slowdown)
    } else if (this.speed < -reverseLimit) {
      const excess = -reverseLimit - this.speed
      const slowdown =
        this.rollingResistance * surface.dragMultiplier * 2.2 * deltaSeconds
      this.speed = -reverseLimit - Math.max(0, excess - slowdown)
    }
  }

  private updateSteering(
    controls: KartControls,
    deltaSeconds: number,
    surface: KartSurfaceHandling,
    powersliding: boolean,
  ) {
    let steerDirection = 0

    if (controls.steerLeft) {
      steerDirection -= 1
    }

    if (controls.steerRight) {
      steerDirection += 1
    }

    if (steerDirection === 0 || Math.abs(this.speed) < 0.01) {
      return
    }

    const speedFactor = Math.min(
      1,
      Math.max(0.2, Math.abs(this.speed) / this.maxForwardSpeed),
    )
    const reverseDirection = this.speed < 0 ? -1 : 1
    const powerslideMultiplier = powersliding ? POWERSLIDE_TURN_MULTIPLIER : 1

    this.angle +=
      steerDirection *
      reverseDirection *
      this.turnRate *
      powerslideMultiplier *
      surface.gripMultiplier *
      speedFactor *
      deltaSeconds
  }

  private updateTravelAngle(deltaSeconds: number, powersliding: boolean) {
    const followRate = powersliding
      ? POWERSLIDE_TRAVEL_FOLLOW
      : NORMAL_TRAVEL_FOLLOW

    let angleDifference = this.angle - this.travelAngle

    while (angleDifference > Math.PI) {
      angleDifference -= Math.PI * 2
    }

    while (angleDifference < -Math.PI) {
      angleDifference += Math.PI * 2
    }

    const followAmount = Math.min(1, followRate * deltaSeconds)
    this.travelAngle += angleDifference * followAmount
  }
}
