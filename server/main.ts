import path from 'node:path'
import { defineRoom, defineServer, Room, type Client } from 'colyseus'
import { ServerCpuSimulation } from './ServerCpuSimulation'
import { ServerTrackMap } from './ServerTrackMap'

type KartSnapshot = {
  id: string
  racerKey: string
  x: number
  y: number
  angle: number
  speedRatio: number
}

type NetworkItemType =
  | 'banana'
  | 'bomb'
  | 'coin'
  | 'egg'
  | 'fireball'
  | 'greenShell'
  | 'redShell'
  | 'mushroom'
  | 'star'

type ItemUsePayload = {
  item?: NetworkItemType
  x?: number
  y?: number
  angle?: number
  speedRatio?: number
}

type NetworkItemUse = {
  id: string
  ownerId: string
  item: NetworkItemType
  x: number
  y: number
  angle: number
  speedRatio: number
}

type JoinOptions = {
  racerKey?: string
  x?: number
  y?: number
  angle?: number
}

const ITEM_TYPES = new Set<NetworkItemType>([
  'banana',
  'bomb',
  'coin',
  'egg',
  'fireball',
  'greenShell',
  'redShell',
  'mushroom',
  'star',
])

const TRACK_PATH = path.resolve(process.cwd(), 'public/assets/tracks/Mario Circuit 1.png')
const COLLISION_PATH = path.resolve(
  process.cwd(),
  'public/assets/tracks/Mario Circuit 1 - Collision.png',
)
const track = await ServerTrackMap.load(TRACK_PATH, COLLISION_PATH)
const WORLD_SCALE = Math.min(track.width, track.height)
const START_X = track.width * 0.91
const START_Y = track.height * 0.66 - WORLD_SCALE * 0.1
const START_HEADING = 0
const CPU_BROADCAST_INTERVAL_MS = 50

console.log(`[retro_kart] server track loaded (${track.width}x${track.height})`)

class RetroKartRoom extends Room {
  maxClients = 21
  private readonly players = new Map<string, KartSnapshot>()
  private readonly cpuSimulation = new ServerCpuSimulation(
    track,
    START_X,
    START_Y,
    START_HEADING,
  )
  private cpuBroadcastAccumulator = 0
  private nextItemEventId = 1

  onCreate() {
    this.setTimestep((deltaTime) => {
      const deltaSeconds = Math.min(deltaTime / 1000, 0.05)
      this.cpuSimulation.update(deltaSeconds)
      this.cpuBroadcastAccumulator += deltaTime

      if (this.cpuBroadcastAccumulator >= CPU_BROADCAST_INTERVAL_MS) {
        this.cpuBroadcastAccumulator %= CPU_BROADCAST_INTERVAL_MS
        this.broadcast('cpus', this.cpuSimulation.snapshots)
      }
    })

    this.onMessage('kart', (client, payload: Partial<KartSnapshot>) => {
      const player = this.players.get(client.sessionId)
      if (!player) return

      if (Number.isFinite(payload.x)) player.x = Number(payload.x)
      if (Number.isFinite(payload.y)) player.y = Number(payload.y)
      if (Number.isFinite(payload.angle)) player.angle = Number(payload.angle)
      if (Number.isFinite(payload.speedRatio)) player.speedRatio = Number(payload.speedRatio)

      this.broadcast('kart', player, { except: client })
    })

    this.onMessage('item-use', (client, payload: ItemUsePayload) => {
      if (!payload || !ITEM_TYPES.has(payload.item as NetworkItemType)) return

      const player = this.players.get(client.sessionId)
      if (!player) return

      const event: NetworkItemUse = {
        id: `item-${this.nextItemEventId++}`,
        ownerId: client.sessionId,
        item: payload.item as NetworkItemType,
        x: Number.isFinite(payload.x) ? Number(payload.x) : player.x,
        y: Number.isFinite(payload.y) ? Number(payload.y) : player.y,
        angle: Number.isFinite(payload.angle) ? Number(payload.angle) : player.angle,
        speedRatio: Number.isFinite(payload.speedRatio)
          ? Number(payload.speedRatio)
          : player.speedRatio,
      }

      this.broadcast('item-use', event, { except: client })
      console.log(`[retro_kart] ${client.sessionId} used ${event.item} (${event.id})`)
    })
  }

  onJoin(client: Client, options: JoinOptions) {
    const player: KartSnapshot = {
      id: client.sessionId,
      racerKey: typeof options.racerKey === 'string' ? options.racerKey : 'racer-mario',
      x: Number.isFinite(options.x) ? Number(options.x) : 0,
      y: Number.isFinite(options.y) ? Number(options.y) : 0,
      angle: Number.isFinite(options.angle) ? Number(options.angle) : 0,
      speedRatio: 0,
    }

    client.send('players', [...this.players.values()])
    client.send('cpus', this.cpuSimulation.snapshots)
    this.players.set(client.sessionId, player)
    this.broadcast('player-joined', player, { except: client })

    console.log(
      `[retro_kart] ${client.sessionId} joined (${this.clients.length}/${this.maxClients}) [CPU server]`,
    )
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId)
    this.broadcast('player-left', { id: client.sessionId })
    console.log(`[retro_kart] ${client.sessionId} left (${this.clients.length}/${this.maxClients})`)
  }
}

const port = Number.parseInt(process.env.PORT ?? '2567', 10)

const server = defineServer({
  rooms: {
    retro_kart: defineRoom(RetroKartRoom),
  },
})

server.listen(port)
console.log(`Retro Kart multiplayer listening on http://localhost:${port}`)
