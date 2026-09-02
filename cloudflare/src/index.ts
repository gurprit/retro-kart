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

type SocketAttachment = {
  id: string
  racerKey: string
}

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
      item?: string
      x?: number
      y?: number
      angle?: number
      speedRatio?: number
    }
  | { type: 'ping'; sentAt?: number }

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'retro-kart-multiplayer', transport: 'cloudflare-durable-objects' })
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

  constructor(state: any) {
    this.state = state

    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null
      if (!attachment?.id) continue
      this.players.set(attachment.id, {
        id: attachment.id,
        racerKey: attachment.racerKey || 'racer-mario',
        x: 0,
        y: 0,
        angle: 0,
        speedRatio: 0,
      })
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'WebSocket upgrade required' }, 426)
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
    server.serializeAttachment({ id, racerKey: player.racerKey } satisfies SocketAttachment)
    this.state.acceptWebSocket(server)

    server.send(JSON.stringify({
      type: 'welcome',
      sessionId: id,
      players: [...this.players.values()].filter((entry) => entry.id !== id),
    }))

    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket })
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
      ;(socket as any).serializeAttachment?.({ id: player.id, racerKey: player.racerKey } satisfies SocketAttachment)
      this.broadcast({ type: 'player-joined', player }, socket)
      return
    }

    if (payload.type === 'kart') {
      player.x = finite(payload.x, player.x)
      player.y = finite(payload.y, player.y)
      player.angle = finite(payload.angle, player.angle)
      player.speedRatio = finite(payload.speedRatio, player.speedRatio)
      this.broadcast({ type: 'kart', player }, socket)
      return
    }

    if (payload.type === 'item-use') {
      this.broadcast({
        type: 'item-use',
        event: {
          id: crypto.randomUUID(),
          ownerId: player.id,
          item: payload.item,
          x: finite(payload.x, player.x),
          y: finite(payload.y, player.y),
          angle: finite(payload.angle, player.angle),
          speedRatio: finite(payload.speedRatio, player.speedRatio),
        },
      }, socket)
    }
  }

  webSocketClose(socket: WebSocket) {
    this.removeSocket(socket)
  }

  webSocketError(socket: WebSocket) {
    this.removeSocket(socket)
  }

  private removeSocket(socket: WebSocket) {
    const attachment = (socket as any).deserializeAttachment?.() as SocketAttachment | undefined
    if (!attachment?.id) return
    if (!this.players.delete(attachment.id)) return
    this.broadcast({ type: 'player-left', id: attachment.id }, socket)
  }

  private broadcast(payload: unknown, except?: WebSocket) {
    const encoded = JSON.stringify(payload)
    for (const socket of this.state.getWebSockets()) {
      if (socket === except) continue
      try {
        socket.send(encoded)
      } catch {
        // The close/error callback will clean up stale sockets.
      }
    }
  }
}
