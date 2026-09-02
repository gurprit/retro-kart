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
const COIN_GRID_SPACING_RATIO = 0.032
const COIN_EDGE_MARGIN_RATIO = 0.018
const COIN_CLEARANCE_RATIO = 0.012

type CoinState = ServerCoinSnapshot & { respawnTimer: number }

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
    this.coins = this.createDenseRoadCoins(worldScale)
    console.log(`[retro_kart] spawned ${this.coins.length} server coins across the road surface`)
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

  private createDenseRoadCoins(worldScale: number) {
    const coins: CoinState[] = []
    const spacing = Math.max(18, worldScale * COIN_GRID_SPACING_RATIO)
    const edgeMargin = Math.max(12, worldScale * COIN_EDGE_MARGIN_RATIO)
    const clearance = Math.max(8, worldScale * COIN_CLEARANCE_RATIO)
    let row = 0

    for (let y = edgeMargin; y < this.track.height - edgeMargin; y += spacing) {
      const stagger = row % 2 === 0 ? 0 : spacing * 0.5
      for (let x = edgeMargin + stagger; x < this.track.width - edgeMargin; x += spacing) {
        if (!this.isSafeRoadPoint(x, y, clearance)) continue
        coins.push({
          id: `coin-${coins.length + 1}`,
          x,
          y,
          active: true,
          respawnTimer: 0,
        })
      }
      row += 1
    }

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
}
