import { ServerCoinSimulation, type CoinTarget } from '../../server/ServerCoinSimulation'
import { ServerCpuSimulation } from '../../server/ServerCpuSimulation'
import {
  ServerItemSimulation,
  type HumanItemTarget,
  type ServerWorldItemKind,
} from '../../server/ServerItemSimulation'
import { ServerTrackMap } from '../../server/ServerTrackMap'
import {
  TRACK_HEIGHT,
  TRACK_ROAD_MASK_BASE64,
  TRACK_SOLID_MASK_BASE64,
  TRACK_WIDTH,
} from './generatedTrackData'

type Env = {
  RACE_ROOMS: {
    idFromName(name: string): unknown
    get(id: unknown): { fetch(request: Request): Promise<Response> }
  }
}

type PlayerSnapshot = {
  id: string
  racerKey: string
  x: number
  y: number
  angle: number
  speedRatio: number
}

type SocketAttachment = PlayerSnapshot

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

type ClientMessage =
  | {
      type: 'join'
      racerKey?: string
      x?: number
      y?: number
      angle?: number
    }
  | {
      type: 'kart'
      x?: number
      y?: number
      angle?: number
      speedRatio?: number
    }
  | {
      type: 'item-use'
      item?: NetworkItemType
      x?: number
      y?: number
      angle?: number
      speedRatio?: number
    }
  | { type: 'ping'; sentAt?: number }

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

const MAX_CLIENTS = 21
const SERVER_TICK_MS = 50
const STAR_DURATION_MS = 6000
const LIGHTNING_SHRINK_DURATION_SECONDS = 6
const LIGHTNING_CONTROL_LOCK_SECONDS = 0.9

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders })
}

function finite(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseMessage(message: string | ArrayBuffer): ClientMessage | undefined {
  if (typeof message !== 'string') return undefined
  try {
    const parsed = JSON.parse(message) as ClientMessage
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function decodeBase64Bytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const track = ServerTrackMap.fromMasks(
  TRACK_WIDTH,
  TRACK_HEIGHT,
  decodeBase64Bytes(TRACK_ROAD_MASK_BASE64),
  decodeBase64Bytes(TRACK_SOLID_MASK_BASE64),
)
const WORLD_SCALE = Math.min(track.width, track.height)
const START_X = track.width * 0.91
const START_Y = track.height * 0.66 - WORLD_SCALE * 0.1
const START_HEADING = 0
const STAR_CONTACT_RADIUS = WORLD_SCALE * 0.036
const STAR_CONTACT_PUSH = WORLD_SCALE * 0.16
const STAR_CONTACT_LOCK_SECONDS = 0.82
const STAR_CONTACT_COOLDOWN_MS = 850

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({
        ok: true,
        service: 'retro-kart-multiplayer',
        transport: 'cloudflare-durable-objects',
        simulation: 'cpu+items+coins',
        track: `${track.width}x${track.height}`,
      })
    }

    const match = url.pathname.match(/^\/room\/([^/]+)$/)
    if (!match) return json({ error: 'Not found' }, 404)

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'WebSocket upgrade required' }, 426)
    }

    const roomName = decodeURIComponent(match[1]).slice(0, 80) || 'public'
    const roomId = env.RACE_ROOMS.idFromName(roomName)
    return env.RACE_ROOMS.get(roomId).fetch(request)
  },
}

export class RaceRoom {
  private readonly state: any
  private readonly players = new Map<string, PlayerSnapshot>()
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
  private simulationTimer?: ReturnType<typeof setInterval>
  private lastTickAt = Date.now()
  private nextItemEventId = 1

  constructor(state: any) {
    this.state = state

    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (!attachment?.id) continue
      this.players.set(attachment.id, { ...attachment })
    }

    if (this.state.getWebSockets().length > 0) this.startSimulation()
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'WebSocket upgrade required' }, 426)
    }

    if (this.state.getWebSockets().length >= MAX_CLIENTS) {
      return json({ error: 'Race room is full' }, 503)
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    const id = crypto.randomUUID()
    const player: PlayerSnapshot = {
      id,
      racerKey: 'racer-mario',
      x: 0,
      y: 0,
      angle: 0,
      speedRatio: 0,
    }

    this.players.set(id, player)
    server.serializeAttachment({ ...player } satisfies SocketAttachment)
    this.state.acceptWebSocket(server)
    this.startSimulation()

    server.send(JSON.stringify({
      type: 'welcome',
      sessionId: id,
      players: [...this.players.values()].filter((entry) => entry.id !== id),
    }))
    server.send(JSON.stringify({ type: 'cpus', snapshots: this.cpuSimulation.snapshots }))
    server.send(JSON.stringify({ type: 'items', snapshots: this.itemSimulation.snapshots }))
    server.send(JSON.stringify({ type: 'coins', snapshots: this.coinSimulation.snapshots }))

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket })
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = (socket as any).deserializeAttachment?.() as SocketAttachment | undefined
    if (!attachment?.id) return
    const payload = parseMessage(message)
    if (!payload) return

    if (payload.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', sentAt: payload.sentAt ?? Date.now() }))
      return
    }

    const player = this.players.get(attachment.id)
    if (!player) return

    if (payload.type === 'join') {
      player.racerKey = typeof payload.racerKey === 'string' ? payload.racerKey : player.racerKey
      player.x = finite(payload.x, player.x)
      player.y = finite(payload.y, player.y)
      player.angle = finite(payload.angle, player.angle)
      this.saveAttachment(socket, player)
      this.broadcast({ type: 'player-joined', player }, socket)
      return
    }

    if (payload.type === 'kart') {
      player.x = finite(payload.x, player.x)
      player.y = finite(payload.y, player.y)
      player.angle = finite(payload.angle, player.angle)
      player.speedRatio = finite(payload.speedRatio, player.speedRatio)
      this.saveAttachment(socket, player)
      this.broadcast({ type: 'kart', player }, socket)
      return
    }

    if (payload.type === 'item-use' && ITEM_TYPES.has(payload.item as NetworkItemType)) {
      this.useItem(player, payload.item as NetworkItemType, payload)
    }
  }

  webSocketClose(socket: WebSocket) {
    this.removeSocket(socket)
  }

  webSocketError(socket: WebSocket) {
    this.removeSocket(socket)
  }

  private startSimulation() {
    if (this.simulationTimer) return
    this.lastTickAt = Date.now()
    this.simulationTimer = setInterval(() => this.tick(), SERVER_TICK_MS)
  }

  private stopSimulationIfEmpty() {
    if (this.state.getWebSockets().length > 0 || !this.simulationTimer) return
    clearInterval(this.simulationTimer)
    this.simulationTimer = undefined
  }

  private tick() {
    const now = Date.now()
    const deltaSeconds = Math.min(Math.max((now - this.lastTickAt) / 1000, 0), 0.05)
    this.lastTickAt = now

    this.cpuSimulation.update(deltaSeconds)
    this.itemSimulation.update(deltaSeconds)
    this.coinSimulation.update(deltaSeconds)
    this.resolveStarContacts(now)

    for (const hit of this.itemSimulation.consumeHits()) {
      this.broadcast({ type: 'item-hit', hit })
    }

    for (const explosion of this.itemSimulation.consumeExplosions()) {
      this.broadcast({ type: 'item-explosion', explosion })
    }

    for (const pickup of this.coinSimulation.consumePickups()) {
      this.broadcast({ type: 'coin-collected', pickup })
    }

    this.broadcast({ type: 'cpus', snapshots: this.cpuSimulation.snapshots })
    this.broadcast({ type: 'items', snapshots: this.itemSimulation.snapshots })
    this.broadcast({ type: 'coins', snapshots: this.coinSimulation.snapshots })

    for (const [id, expiresAt] of this.playerStarUntil) {
      if (expiresAt <= now) this.playerStarUntil.delete(id)
    }
    for (const [key, expiresAt] of this.starContactCooldown) {
      if (expiresAt <= now) this.starContactCooldown.delete(key)
    }
  }

  private useItem(
    player: PlayerSnapshot,
    item: NetworkItemType,
    payload: Extract<ClientMessage, { type: 'item-use' }>,
  ) {
    const event = {
      id: `item-${this.nextItemEventId++}`,
      ownerId: player.id,
      item,
      x: finite(payload.x, player.x),
      y: finite(payload.y, player.y),
      angle: finite(payload.angle, player.angle),
      speedRatio: finite(payload.speedRatio, player.speedRatio),
    }

    if (item === 'star') {
      this.playerStarUntil.set(player.id, Date.now() + STAR_DURATION_MS)
      this.broadcast({
        type: 'star-activated',
        event: { ownerId: player.id, durationSeconds: STAR_DURATION_MS / 1000 },
      })
      return
    }

    if (item === 'fireball') {
      this.activateLightning(player.id)
      return
    }

    if (item === 'egg') {
      this.broadcast({ type: 'feather-activated', event: { ownerId: player.id } })
      return
    }

    if (WORLD_ITEM_TYPES.has(item as ServerWorldItemKind)) {
      const spawned = this.itemSimulation.spawn(
        event.id,
        event.ownerId,
        item as ServerWorldItemKind,
        event.x,
        event.y,
        event.angle,
      )
      if (spawned) this.broadcast({ type: 'item-spawn', snapshot: spawned })
      return
    }

    this.broadcast({ type: 'item-use', event }, undefined, player.id)
  }

  private activateLightning(ownerId: string) {
    const now = Date.now()
    this.cpuSimulation.applyLightning(
      LIGHTNING_SHRINK_DURATION_SECONDS,
      LIGHTNING_CONTROL_LOCK_SECONDS,
    )

    const targetIds = [...this.players.values()]
      .filter((player) => player.id !== ownerId)
      .filter((player) => (this.playerStarUntil.get(player.id) ?? 0) <= now)
      .map((player) => player.id)

    this.broadcast({
      type: 'lightning',
      event: {
        ownerId,
        targetIds,
        shrinkDurationSeconds: LIGHTNING_SHRINK_DURATION_SECONDS,
        controlLockSeconds: LIGHTNING_CONTROL_LOCK_SECONDS,
      },
    })
  }

  private resolveStarContacts(now: number) {
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

    this.broadcast({
      type: 'star-hit',
      hit: {
        ownerId,
        targetId,
        targetType,
        blastX,
        blastY,
        pushStrength: STAR_CONTACT_PUSH,
        controlLockSeconds: STAR_CONTACT_LOCK_SECONDS,
      },
    })
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

  private saveAttachment(socket: WebSocket, player: PlayerSnapshot) {
    ;(socket as any).serializeAttachment?.({ ...player } satisfies SocketAttachment)
  }

  private removeSocket(socket: WebSocket) {
    const attachment = (socket as any).deserializeAttachment?.() as SocketAttachment | undefined
    if (!attachment?.id) return
    if (!this.players.delete(attachment.id)) return
    this.playerStarUntil.delete(attachment.id)
    this.broadcast({ type: 'player-left', id: attachment.id }, socket)
    this.stopSimulationIfEmpty()
  }

  private broadcast(
    payload: unknown,
    except?: WebSocket,
    exceptPlayerId?: string,
  ) {
    const encoded = JSON.stringify(payload)
    for (const socket of this.state.getWebSockets()) {
      if (socket === except) continue
      if (exceptPlayerId) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null
        if (attachment?.id === exceptPlayerId) continue
      }
      try {
        socket.send(encoded)
      } catch {
        // The close/error callback will clean up stale sockets.
      }
    }
  }

  private distanceSq(ax: number, ay: number, bx: number, by: number) {
    const dx = ax - bx
    const dy = ay - by
    return dx * dx + dy * dy
  }
}
