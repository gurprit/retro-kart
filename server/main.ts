import path from 'node:path'
import { defineRoom, defineServer, Room, type Client } from 'colyseus'
import { ServerCoinSimulation, type CoinTarget } from './ServerCoinSimulation'
import { ServerCpuSimulation } from './ServerCpuSimulation'
import {
  ServerItemSimulation,
  type HumanItemTarget,
  type ServerWorldItemKind,
} from './ServerItemSimulation'
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

const WORLD_ITEM_TYPES = new Set<ServerWorldItemKind>([
  'banana',
  'bomb',
  'fireball',
  'greenShell',
  'redShell',
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
const SERVER_BROADCAST_INTERVAL_MS = 50
const STAR_DURATION_MS = 6000
const STAR_CONTACT_RADIUS = WORLD_SCALE * 0.036
const STAR_CONTACT_PUSH = WORLD_SCALE * 0.16
const STAR_CONTACT_LOCK_SECONDS = 0.82
const STAR_CONTACT_COOLDOWN_MS = 850
const LIGHTNING_SHRINK_DURATION_SECONDS = 6
const LIGHTNING_CONTROL_LOCK_SECONDS = 0.9

console.log(`[retro_kart] server track loaded (${track.width}x${track.height})`)

class RetroKartRoom extends Room {
  maxClients = 21
  private readonly players = new Map<string, KartSnapshot>()
  private readonly playerStarUntil = new Map<string, number>()
  private readonly starContactCooldown = new Map<string, number>()
  private readonly cpuSimulation = new ServerCpuSimulation(
    track,
    START_X,
    START_Y,
    START_HEADING,
  )
  private readonly itemSimulation = new ServerItemSimulation(
    track,
    this.cpuSimulation,
    () => this.getHumanItemTargets(),
  )
  private readonly coinSimulation = new ServerCoinSimulation(
    track,
    this.cpuSimulation,
    () => this.getHumanCoinTargets(),
  )
  private broadcastAccumulator = 0
  private nextItemEventId = 1

  onCreate() {
    this.setTimestep((deltaTime) => {
      const deltaSeconds = Math.min(deltaTime / 1000, 0.05)
      this.cpuSimulation.update(deltaSeconds)
      this.itemSimulation.update(deltaSeconds)
      this.coinSimulation.update(deltaSeconds)
      this.resolveStarContacts()

      for (const hit of this.itemSimulation.consumeHits()) {
        this.broadcast('item-hit', hit)
        console.log(`[retro_kart] ${hit.itemId} hit ${hit.targetType} ${hit.targetId}`)
      }

      for (const explosion of this.itemSimulation.consumeExplosions()) {
        this.broadcast('item-explosion', explosion)
      }

      for (const pickup of this.coinSimulation.consumePickups()) {
        this.broadcast('coin-collected', pickup)
        console.log(`[retro_kart] ${pickup.racerId} collected ${pickup.coinId}`)
      }

      this.broadcastAccumulator += deltaTime
      if (this.broadcastAccumulator >= SERVER_BROADCAST_INTERVAL_MS) {
        this.broadcastAccumulator %= SERVER_BROADCAST_INTERVAL_MS
        this.broadcast('cpus', this.cpuSimulation.snapshots)
        this.broadcast('items', this.itemSimulation.snapshots)
        this.broadcast('coins', this.coinSimulation.snapshots)
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

      if (event.item === 'star') {
        this.playerStarUntil.set(client.sessionId, Date.now() + STAR_DURATION_MS)
        this.broadcast('star-activated', {
          ownerId: client.sessionId,
          durationSeconds: STAR_DURATION_MS / 1000,
        })
      } else if (event.item === 'fireball') {
        this.activateLightning(client.sessionId)
      } else if (event.item === 'egg') {
        this.broadcast('feather-activated', {
          ownerId: client.sessionId,
        })
      } else if (WORLD_ITEM_TYPES.has(event.item as ServerWorldItemKind)) {
        const spawned = this.itemSimulation.spawn(
          event.id,
          event.ownerId,
          event.item as ServerWorldItemKind,
          event.x,
          event.y,
          event.angle,
        )
        if (spawned) this.broadcast('item-spawn', spawned)
      } else {
        this.broadcast('item-use', event, { except: client })
      }

      const itemLabel =
        event.item === 'egg' ? 'feather' : event.item === 'fireball' ? 'lightning' : event.item
      console.log(`[retro_kart] ${client.sessionId} used ${itemLabel} (${event.id})`)
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
    client.send('items', this.itemSimulation.snapshots)
    client.send('coins', this.coinSimulation.snapshots)
    this.players.set(client.sessionId, player)
    this.broadcast('player-joined', player, { except: client })

    console.log(
      `[retro_kart] ${client.sessionId} joined (${this.clients.length}/${this.maxClients}) [CPU+ITEM+COIN server]`,
    )
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId)
    this.playerStarUntil.delete(client.sessionId)
    this.broadcast('player-left', { id: client.sessionId })
    console.log(`[retro_kart] ${client.sessionId} left (${this.clients.length}/${this.maxClients})`)
  }

  private activateLightning(ownerId: string) {
    const now = Date.now()
    this.cpuSimulation.applyLightning(
      LIGHTNING_SHRINK_DURATION_SECONDS,
      LIGHTNING_CONTROL_LOCK_SECONDS,
    )

    const targets = [...this.players.values()]
      .filter((player) => player.id !== ownerId)
      .filter((player) => (this.playerStarUntil.get(player.id) ?? 0) <= now)
      .map((player) => player.id)

    this.broadcast('lightning', {
      ownerId,
      targetIds: targets,
      shrinkDurationSeconds: LIGHTNING_SHRINK_DURATION_SECONDS,
      controlLockSeconds: LIGHTNING_CONTROL_LOCK_SECONDS,
    })
  }

  private resolveStarContacts() {
    const now = Date.now()
    const radiusSq = STAR_CONTACT_RADIUS * STAR_CONTACT_RADIUS
    const humans = [...this.players.values()]

    for (const attacker of humans) {
      if ((this.playerStarUntil.get(attacker.id) ?? 0) <= now) continue

      for (const target of humans) {
        if (target.id === attacker.id) continue
        if ((this.playerStarUntil.get(target.id) ?? 0) > now) continue
        if (this.distanceSq(attacker.x, attacker.y, target.x, target.y) > radiusSq) continue
        this.applyStarContact(attacker.id, attacker.x, attacker.y, target.id, 'human', now)
      }

      for (const target of this.cpuSimulation.itemStates) {
        if (target.invulnerable) continue
        if (this.distanceSq(attacker.x, attacker.y, target.x, target.y) > radiusSq) continue
        this.applyStarContact(attacker.id, attacker.x, attacker.y, target.id, 'cpu', now)
      }
    }
  }

  private applyStarContact(
    ownerId: string,
    blastX: number,
    blastY: number,
    targetId: string,
    targetType: 'human' | 'cpu',
    now: number,
  ) {
    const key = `${ownerId}:${targetId}`
    if ((this.starContactCooldown.get(key) ?? 0) > now) return
    this.starContactCooldown.set(key, now + STAR_CONTACT_COOLDOWN_MS)

    if (targetType === 'cpu') {
      this.cpuSimulation.spinOut(
        targetId,
        blastX,
        blastY,
        STAR_CONTACT_PUSH,
        STAR_CONTACT_LOCK_SECONDS,
      )
    }

    this.broadcast('star-hit', {
      ownerId,
      targetId,
      targetType,
      blastX,
      blastY,
      pushStrength: STAR_CONTACT_PUSH,
      controlLockSeconds: STAR_CONTACT_LOCK_SECONDS,
    })
    console.log(`[retro_kart] star ${ownerId} hit ${targetType} ${targetId}`)
  }

  private getHumanItemTargets(): HumanItemTarget[] {
    const now = Date.now()
    return [...this.players.values()].map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      invulnerable: (this.playerStarUntil.get(player.id) ?? 0) > now,
    }))
  }

  private getHumanCoinTargets(): CoinTarget[] {
    return [...this.players.values()].map((player) => ({
      id: player.id,
      x: player.x,
      y: player.y,
      targetType: 'human' as const,
    }))
  }

  private distanceSq(ax: number, ay: number, bx: number, by: number) {
    const dx = ax - bx
    const dy = ay - by
    return dx * dx + dy * dy
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
