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
const KNOCKBACK_DAMPING = 4.2
const MAX_COINS = 10
const COIN_TOP_SPEED_BONUS = 0.012
const STAR_SPEED_MULTIPLIER = 1.12

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
  private controlLockTimer = 0
  private boostTimer = 0
  private boostMultiplier = 1
  private starTimer = 0
  private knockbackVx = 0
  private knockbackVy = 0
  private coinCount = 0

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
    this.maxForwardSpeed = baseForwardSpeed * racerProfile.topSpeedMultiplier
    this.maxReverseSpeed = this.maxForwardSpeed * 0.34
    this.acceleration = baseForwardSpeed * 0.82 * racerProfile.accelerationMultiplier
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
    this.controlLockTimer = Math.max(0, this.controlLockTimer - deltaSeconds)
    this.starTimer = Math.max(0, this.starTimer - deltaSeconds)

    if (this.boostTimer > 0) {
      this.boostTimer = Math.max(0, this.boostTimer - deltaSeconds)
      if (this.boostTimer === 0) this.boostMultiplier = 1
    }

    const effectiveControls =
      this.controlLockTimer > 0
        ? { accelerate: false, brake: false, steerLeft: false, steerRight: false, powerslide: false }
        : controls

    const canPowerslide =
      effectiveControls.powerslide &&
      (effectiveControls.steerLeft || effectiveControls.steerRight) &&
      Math.abs(this.speedRatio) >= POWERSLIDE_MIN_SPEED_RATIO &&
      this.hitTimer === 0

    this.state =
      this.hitTimer > 0 || this.controlLockTimer > 0
        ? 'hit'
        : canPowerslide
          ? 'powerslide'
          : 'normal'

    this.updateSpeed(effectiveControls, deltaSeconds, surface)
    this.updateSteering(effectiveControls, deltaSeconds, surface, canPowerslide)
    this.updateTravelAngle(deltaSeconds, canPowerslide)

    const distance = this.speed * deltaSeconds
    this.x += Math.sin(this.travelAngle) * distance + this.knockbackVx * deltaSeconds
    this.y -= Math.cos(this.travelAngle) * distance - this.knockbackVy * deltaSeconds

    const damping = Math.exp(-KNOCKBACK_DAMPING * deltaSeconds)
    this.knockbackVx *= damping
    this.knockbackVy *= damping
  }

  get speedRatio() {
    return this.speed / this.maxForwardSpeed
  }

  get isInvulnerable() {
    return this.starTimer > 0
  }

  get coins() {
    return this.coinCount
  }

  applyCollision(x: number, y: number) {
    this.x = x
    this.y = y
    this.speed = -this.speed * COLLISION_BOUNCE
    this.travelAngle = this.angle
    this.hitTimer = COLLISION_HIT_TIME
    this.state = 'hit'
  }

  applySpinOut(
    blastX: number,
    blastY: number,
    pushStrength: number,
    controlLockSeconds: number,
  ) {
    if (this.isInvulnerable) return

    let dx = this.x - blastX
    let dy = this.y - blastY
    let length = Math.hypot(dx, dy)
    if (length < 0.001) {
      dx = Math.sin(this.angle)
      dy = -Math.cos(this.angle)
      length = 1
    }

    this.knockbackVx += (dx / length) * pushStrength
    this.knockbackVy += (dy / length) * pushStrength
    this.speed *= 0.35
    this.controlLockTimer = Math.max(this.controlLockTimer, controlLockSeconds)
    this.hitTimer = Math.max(this.hitTimer, controlLockSeconds)
    this.state = 'hit'
  }

  applyLightningHit(controlLockSeconds: number) {
    if (this.isInvulnerable) return
    this.speed *= 0.5
    this.controlLockTimer = Math.max(this.controlLockTimer, controlLockSeconds)
    this.hitTimer = Math.max(this.hitTimer, controlLockSeconds)
    this.state = 'hit'
  }

  applyBoost(multiplier: number, durationSeconds: number) {
    this.boostMultiplier = Math.max(this.boostMultiplier, multiplier)
    this.boostTimer = Math.max(this.boostTimer, durationSeconds)
    const boostedSpeed = this.maxForwardSpeed * multiplier
    this.speed = Math.max(this.speed, boostedSpeed * 0.72)
  }

  grantStar(durationSeconds: number) {
    this.starTimer = Math.max(this.starTimer, durationSeconds)
    this.controlLockTimer = 0
    this.hitTimer = 0
  }

  addCoins(amount: number) {
    this.coinCount = Math.min(MAX_COINS, Math.max(0, this.coinCount + amount))
  }

  private updateSpeed(
    controls: KartControls,
    deltaSeconds: number,
    surface: KartSurfaceHandling,
  ) {
    const coinMultiplier = 1 + this.coinCount * COIN_TOP_SPEED_BONUS
    const starMultiplier = this.isInvulnerable ? STAR_SPEED_MULTIPLIER : 1
    const itemMultiplier = Math.max(this.boostMultiplier, starMultiplier)
    const forwardLimit =
      this.maxForwardSpeed * surface.speedMultiplier * coinMultiplier * itemMultiplier
    const reverseLimit = this.maxReverseSpeed * surface.speedMultiplier

    if (controls.accelerate) {
      if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + this.braking * deltaSeconds)
      } else {
        this.speed = Math.min(
          forwardLimit,
          this.speed + this.acceleration * itemMultiplier * deltaSeconds,
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
      const resistance = this.rollingResistance * surface.dragMultiplier * deltaSeconds
      if (this.speed > 0) this.speed = Math.max(0, this.speed - resistance)
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + resistance)
    }

    if (this.speed > forwardLimit) {
      const excess = this.speed - forwardLimit
      const slowdown = this.rollingResistance * surface.dragMultiplier * 2.2 * deltaSeconds
      this.speed = forwardLimit + Math.max(0, excess - slowdown)
    } else if (this.speed < -reverseLimit) {
      const excess = -reverseLimit - this.speed
      const slowdown = this.rollingResistance * surface.dragMultiplier * 2.2 * deltaSeconds
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
    if (controls.steerLeft) steerDirection -= 1
    if (controls.steerRight) steerDirection += 1
    if (steerDirection === 0 || Math.abs(this.speed) < 0.01) return

    const speedFactor = Math.min(1, Math.max(0.2, Math.abs(this.speed) / this.maxForwardSpeed))
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
    const followRate = powersliding ? POWERSLIDE_TRAVEL_FOLLOW : NORMAL_TRAVEL_FOLLOW
    let angleDifference = this.angle - this.travelAngle
    while (angleDifference > Math.PI) angleDifference -= Math.PI * 2
    while (angleDifference < -Math.PI) angleDifference += Math.PI * 2
    const followAmount = Math.min(1, followRate * deltaSeconds)
    this.travelAngle += angleDifference * followAmount
  }
}
