import { ServerCpuSimulation } from './ServerCpuSimulation'
import { ServerTrackMap } from './ServerTrackMap'

export type CoinTarget = {
  id: string
  x: number
  y: number
  targetType: 'human' | 'cpu'
}

export type ServerCoinSnapshot = {
  id: string
  x: number
  y: number
  active: boolean
}

export type ServerCoinPickup = {
  coinId: string
  racerId: string
  targetType: 'human' | 'cpu'
}

const TRACK_COIN_RESPAWN_SECONDS = 4.5
const PICKUP_RADIUS_RATIO = 0.025
const COINS_PER_CORNER = 20
const COIN_SAMPLE_SPACING_RATIO = 0.018
const COIN_CLEARANCE_RATIO = 0.012

type CoinState = ServerCoinSnapshot & { respawnTimer: number }
type RoadPoint = { x: number; y: number }

export class ServerCoinSimulation {
  private readonly coins: CoinState[]
  private readonly pickupRadiusSq: number
  private pendingPickups: ServerCoinPickup[] = []

  constructor(
    private readonly track: ServerTrackMap,
    private readonly cpus: ServerCpuSimulation,
    private readonly getHumans: () => readonly CoinTarget[],
  ) {
    const worldScale = Math.min(track.width, track.height)
    const radius = worldScale * PICKUP_RADIUS_RATIO
    this.pickupRadiusSq = radius * radius
    this.coins = this.createCornerCoins(worldScale)
    console.log(
      `[retro_kart] spawned ${this.coins.length} server coins (${COINS_PER_CORNER} per big corner)`,
    )
  }

  update(deltaSeconds: number) {
    this.pendingPickups = []
    const targets: CoinTarget[] = [
      ...this.getHumans(),
      ...this.cpus.itemStates.map((cpu) => ({
        id: cpu.id,
        x: cpu.x,
        y: cpu.y,
        targetType: 'cpu' as const,
      })),
    ]

    for (const coin of this.coins) {
      if (!coin.active) {
        coin.respawnTimer = Math.max(0, coin.respawnTimer - deltaSeconds)
        if (coin.respawnTimer === 0) coin.active = true
        continue
      }

      const target = targets.find((candidate) => {
        const dx = candidate.x - coin.x
        const dy = candidate.y - coin.y
        return dx * dx + dy * dy <= this.pickupRadiusSq
      })
      if (!target) continue

      coin.active = false
      coin.respawnTimer = TRACK_COIN_RESPAWN_SECONDS
      if (target.targetType === 'cpu') this.cpus.addCoin(target.id, 1)
      this.pendingPickups.push({
        coinId: coin.id,
        racerId: target.id,
        targetType: target.targetType,
      })
    }
  }

  get snapshots(): ServerCoinSnapshot[] {
    return this.coins.map(({ id, x, y, active }) => ({ id, x, y, active }))
  }

  consumePickups() {
    const pickups = this.pendingPickups
    this.pendingPickups = []
    return pickups
  }

  private createCornerCoins(worldScale: number) {
    const spacing = Math.max(14, worldScale * COIN_SAMPLE_SPACING_RATIO)
    const clearance = Math.max(8, worldScale * COIN_CLEARANCE_RATIO)
    const candidates: RoadPoint[] = []

    for (let y = spacing; y < this.track.height - spacing; y += spacing) {
      for (let x = spacing; x < this.track.width - spacing; x += spacing) {
        if (this.isSafeRoadPoint(x, y, clearance)) candidates.push({ x, y })
      }
    }

    const quadrants = [
      candidates.filter((point) => point.x < this.track.width / 2 && point.y < this.track.height / 2),
      candidates.filter((point) => point.x >= this.track.width / 2 && point.y < this.track.height / 2),
      candidates.filter((point) => point.x < this.track.width / 2 && point.y >= this.track.height / 2),
      candidates.filter((point) => point.x >= this.track.width / 2 && point.y >= this.track.height / 2),
    ]

    const coins: CoinState[] = []
    quadrants.forEach((points, quadrantIndex) => {
      if (points.length === 0) return

      const centroid = points.reduce(
        (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
        { x: 0, y: 0 },
      )
      centroid.x /= points.length
      centroid.y /= points.length

      const ordered = [...points].sort(
        (a, b) =>
          this.distanceSq(a.x, a.y, centroid.x, centroid.y) -
          this.distanceSq(b.x, b.y, centroid.x, centroid.y),
      )

      const selected: RoadPoint[] = []
      const minSeparationSq = Math.pow(spacing * 0.78, 2)
      for (const point of ordered) {
        if (selected.some((other) => this.distanceSq(point.x, point.y, other.x, other.y) < minSeparationSq)) {
          continue
        }
        selected.push(point)
        if (selected.length >= COINS_PER_CORNER) break
      }

      if (selected.length < COINS_PER_CORNER) {
        for (const point of ordered) {
          if (selected.includes(point)) continue
          selected.push(point)
          if (selected.length >= COINS_PER_CORNER) break
        }
      }

      selected.slice(0, COINS_PER_CORNER).forEach((point, index) => {
        coins.push({
          id: `corner-${quadrantIndex + 1}-coin-${index + 1}`,
          x: point.x,
          y: point.y,
          active: true,
          respawnTimer: 0,
        })
      })
    })

    return coins
  }

  private isSafeRoadPoint(x: number, y: number, clearance: number) {
    const diagonal = clearance * 0.72
    const checks = [
      [0, 0],
      [clearance, 0],
      [-clearance, 0],
      [0, clearance],
      [0, -clearance],
      [diagonal, diagonal],
      [-diagonal, diagonal],
      [diagonal, -diagonal],
      [-diagonal, -diagonal],
    ] as const

    return checks.every(([dx, dy]) => this.track.sample(x + dx, y + dy) === 'road')
  }

  private distanceSq(ax: number, ay: number, bx: number, by: number) {
    const dx = ax - bx
    const dy = ay - by
    return dx * dx + dy * dy
  }
}
