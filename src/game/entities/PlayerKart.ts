export type KartControls = {
  accelerate: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
}

export type KartSurfaceHandling = {
  speedMultiplier: number
  gripMultiplier: number
  dragMultiplier: number
}

const DEFAULT_SURFACE: KartSurfaceHandling = {
  speedMultiplier: 1,
  gripMultiplier: 1,
  dragMultiplier: 1,
}

export class PlayerKart {
  x: number
  y: number
  angle: number
  speed = 0

  readonly maxForwardSpeed: number
  readonly maxReverseSpeed: number

  private readonly acceleration: number
  private readonly braking: number
  private readonly reverseAcceleration: number
  private readonly rollingResistance: number
  private readonly turnRate: number

  constructor(x: number, y: number, angle: number, worldScale: number) {
    this.x = x
    this.y = y
    this.angle = angle

    this.maxForwardSpeed = worldScale * 0.32
    this.maxReverseSpeed = this.maxForwardSpeed * 0.34
    this.acceleration = this.maxForwardSpeed * 0.82
    this.braking = this.maxForwardSpeed * 1.55
    this.reverseAcceleration = this.maxForwardSpeed * 0.56
    this.rollingResistance = this.maxForwardSpeed * 0.42
    this.turnRate = 2.15
  }

  update(
    controls: KartControls,
    deltaSeconds: number,
    surface: KartSurfaceHandling = DEFAULT_SURFACE,
  ) {
    this.updateSpeed(controls, deltaSeconds, surface)
    this.updateSteering(controls, deltaSeconds, surface)

    const distance = this.speed * deltaSeconds
    this.x += Math.sin(this.angle) * distance
    this.y -= Math.cos(this.angle) * distance
  }

  get speedRatio() {
    return this.speed / this.maxForwardSpeed
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

    this.angle +=
      steerDirection *
      reverseDirection *
      this.turnRate *
      surface.gripMultiplier *
      speedFactor *
      deltaSeconds
  }
}
