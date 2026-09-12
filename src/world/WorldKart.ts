export type WorldControls = {
  accelerate: boolean
  brake: boolean
  left: boolean
  right: boolean
  powerslide: boolean
}

export type WorldSurface = 'road' | 'offroad'

const MAX_SPEED_METRES_PER_SECOND = 38.9 // 140 km/h
const REVERSE_RATIO = 0.34
const ACCELERATION = MAX_SPEED_METRES_PER_SECOND * 0.82
const BRAKING = MAX_SPEED_METRES_PER_SECOND * 1.55
const ROLLING_RESISTANCE = MAX_SPEED_METRES_PER_SECOND * 0.42
const TURN_RATE = 2.15

/** The classic PlayerKart dynamics expressed in metres rather than texture pixels. */
export class WorldKart {
  lng: number
  lat: number
  heading: number
  speed = 0
  private travelHeading: number

  constructor(lng: number, lat: number, heading: number) {
    this.lng = lng
    this.lat = lat
    this.heading = heading
    this.travelHeading = heading
  }

  update(controls: WorldControls, dt: number, surface: WorldSurface) {
    const speedLimit = MAX_SPEED_METRES_PER_SECOND * (surface === 'road' ? 1 : 0.36)
    const drag = surface === 'road' ? 1 : 3.5

    if (controls.accelerate) {
      this.speed = this.speed < 0
        ? Math.min(0, this.speed + BRAKING * dt)
        : Math.min(speedLimit, this.speed + ACCELERATION * dt)
    } else if (controls.brake) {
      this.speed = this.speed > 0
        ? Math.max(0, this.speed - BRAKING * dt)
        : Math.max(-speedLimit * REVERSE_RATIO, this.speed - ACCELERATION * 0.56 * dt)
    } else {
      const resistance = ROLLING_RESISTANCE * drag * dt
      this.speed += this.speed > 0 ? -Math.min(this.speed, resistance) : Math.min(-this.speed, resistance)
    }

    if (this.speed > speedLimit) {
      this.speed = Math.max(speedLimit, this.speed - ROLLING_RESISTANCE * drag * 2.2 * dt)
    }

    const steer = Number(controls.right) - Number(controls.left)
    if (steer && Math.abs(this.speed) > 0.05) {
      const speedFactor = Math.min(1, Math.max(0.2, Math.abs(this.speed) / MAX_SPEED_METRES_PER_SECOND))
      this.heading += steer * Math.sign(this.speed) * TURN_RATE *
        (controls.powerslide ? 1.55 : 1) * (surface === 'road' ? 1 : 0.68) * speedFactor * dt
    }

    let difference = this.heading - this.travelHeading
    while (difference > Math.PI) difference -= Math.PI * 2
    while (difference < -Math.PI) difference += Math.PI * 2
    this.travelHeading += difference * Math.min(1, (controls.powerslide ? 3.2 : 12) * dt)

    const distance = this.speed * dt
    const north = Math.cos(this.travelHeading) * distance
    const east = Math.sin(this.travelHeading) * distance
    this.lat += north / 111_320
    this.lng += east / (111_320 * Math.cos(this.lat * Math.PI / 180))
  }

  get kilometresPerHour() { return Math.abs(this.speed) * 3.6 }
}
