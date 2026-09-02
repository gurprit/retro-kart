import { ServerCpuSimulation } from './ServerCpuSimulation'

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

const TRACK_COINS = [
  { xRatio: 0.91, yRatio: 0.61 },
  { xRatio: 0.91, yRatio: 0.57 },
  { xRatio: 0.89, yRatio: 0.53 },
  { xRatio: 0.78, yRatio: 0.49 },
  { xRatio: 0.66, yRatio: 0.45 },
  { xRatio: 0.53, yRatio: 0.42 },
  { xRatio: 0.4, yRatio: 0.46 },
  { xRatio: 0.31, yRatio: 0.56 },
  { xRatio: 0.42, yRatio: 0.67 },
  { xRatio: 0.64, yRatio: 0.68 },
] as const

type CoinState = ServerCoinSnapshot & { respawnTimer: number }

export class ServerCoinSimulation {
  private readonly coins: CoinState[]
  private readonly pickupRadiusSq: number
  private pendingPickups: ServerCoinPickup[] = []

  constructor(
    width: number,
    height: number,
    private readonly cpus: ServerCpuSimulation,
    private readonly getHumans: () => readonly CoinTarget[],
  ) {
    const worldScale = Math.min(width, height)
    const radius = worldScale * PICKUP_RADIUS_RATIO
    this.pickupRadiusSq = radius * radius
    this.coins = TRACK_COINS.map((definition, index) => ({
      id: `coin-${index + 1}`,
      x: width * definition.xRatio,
      y: height * definition.yRatio,
      active: true,
      respawnTimer: 0,
    }))
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
}
