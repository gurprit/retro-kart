export type KartControls = {
  accelerate: boolean
  brake: boolean
  steerLeft: boolean
  steerRight: boolean
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

  update(controls: KartControls, deltaSeconds: number) {
    this.updateSpeed(controls, deltaSeconds)
    this.updateSteering(controls, deltaSeconds)

    const distance = this.speed * deltaSeconds
    this.x += Math.sin(this.angle) * distance
    this.y -= Math.cos(this.angle) * distance
  }

  get speedRatio() {
    return this.speed / this.maxForwardSpeed
  }

  private updateSpeed(controls: KartControls, deltaSeconds: number) {
    if (controls.accelerate) {
      if (this.speed < 0) {
        this.speed = Math.min(0, this.speed + this.braking * deltaSeconds)
      } else {
        this.speed = Math.min(
          this.maxForwardSpeed,
          this.speed + this.acceleration * deltaSeconds,
        )
      }
      return
    }

    if (controls.brake) {
      if (this.speed > 0) {
        this.speed = Math.max(0, this.speed - this.braking * deltaSeconds)
      } else {
        this.speed = Math.max(
          -this.maxReverseSpeed,
          this.speed - this.reverseAcceleration * deltaSeconds,
        )
      }
      return
    }

    const resistance = this.rollingResistance * deltaSeconds

    if (this.speed > 0) {
      this.speed = Math.max(0, this.speed - resistance)
    } else if (this.speed < 0) {
      this.speed = Math.min(0, this.speed + resistance)
    }
  }

  private updateSteering(controls: KartControls, deltaSeconds: number) {
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
      speedFactor *
      deltaSeconds
  }
}
