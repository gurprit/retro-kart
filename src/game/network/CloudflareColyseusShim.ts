type MessageHandler = (payload: any) => void

type LeaveHandler = (code?: number) => void

type ErrorHandler = (code: number, message: string) => void

type WorkerEnvelope = {
  type?: string
  [key: string]: unknown
}

const PAYLOAD_KEYS: Record<string, string> = {
  'player-joined': 'player',
  kart: 'player',
  cpus: 'snapshots',
  items: 'snapshots',
  coins: 'snapshots',
  'item-spawn': 'snapshot',
  'item-hit': 'hit',
  'item-explosion': 'explosion',
  lightning: 'event',
  'star-activated': 'event',
  'star-hit': 'hit',
  'coin-collected': 'pickup',
  'feather-activated': 'event',
}

function toWebSocketBase(endpoint: string) {
  const trimmed = endpoint.replace(/\/+$/, '')
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) return trimmed
  return `wss://${trimmed}`
}

class CloudflareRoom {
  readonly roomId: string
  sessionId = ''

  private readonly socket: WebSocket
  private readonly messageHandlers = new Map<string, Set<MessageHandler>>()
  private readonly bufferedMessages = new Map<string, unknown[]>()
  private readonly leaveHandlers = new Set<LeaveHandler>()
  private readonly errorHandlers = new Set<ErrorHandler>()
  private explicitlyLeaving = false

  constructor(socket: WebSocket, roomId: string) {
    this.socket = socket
    this.roomId = roomId

    socket.addEventListener('message', (event) => this.handleMessage(event.data))
    socket.addEventListener('close', (event) => {
      for (const handler of this.leaveHandlers) handler(event.code)
    })
    socket.addEventListener('error', () => {
      if (this.explicitlyLeaving) return
      for (const handler of this.errorHandlers) handler(0, 'Cloudflare WebSocket connection error')
    })
  }

  onMessage(type: string, handler: MessageHandler) {
    let handlers = this.messageHandlers.get(type)
    if (!handlers) {
      handlers = new Set()
      this.messageHandlers.set(type, handlers)
    }
    handlers.add(handler)

    const buffered = this.bufferedMessages.get(type)
    if (buffered?.length) {
      this.bufferedMessages.delete(type)
      for (const payload of buffered) handler(payload)
    }

    return () => handlers?.delete(handler)
  }

  onLeave(handler: LeaveHandler) {
    this.leaveHandlers.add(handler)
    return () => this.leaveHandlers.delete(handler)
  }

  onError(handler: ErrorHandler) {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  send(type: string, payload: unknown) {
    if (this.socket.readyState !== WebSocket.OPEN) return
    const body = payload && typeof payload === 'object'
      ? { type, ...(payload as Record<string, unknown>) }
      : { type, payload }
    this.socket.send(JSON.stringify(body))
  }

  leave() {
    this.explicitlyLeaving = true
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve()
    this.socket.close(1000, 'client leave')
    return Promise.resolve()
  }

  private handleMessage(raw: unknown) {
    if (typeof raw !== 'string') return

    let envelope: WorkerEnvelope
    try {
      envelope = JSON.parse(raw) as WorkerEnvelope
    } catch {
      return
    }

    const type = typeof envelope.type === 'string' ? envelope.type : ''
    if (!type) return

    if (type === 'welcome') {
      if (typeof envelope.sessionId === 'string') this.sessionId = envelope.sessionId
      this.emit('players', Array.isArray(envelope.players) ? envelope.players : [])
      return
    }

    const payloadKey = PAYLOAD_KEYS[type]
    const payload = payloadKey ? envelope[payloadKey] : envelope
    this.emit(type, payload)
  }

  private emit(type: string, payload: unknown) {
    const handlers = this.messageHandlers.get(type)
    if (handlers?.size) {
      for (const handler of handlers) handler(payload)
      return
    }

    const buffered = this.bufferedMessages.get(type) ?? []
    buffered.push(payload)
    this.bufferedMessages.set(type, buffered)
  }
}

export class Client {
  private readonly endpoint: string

  constructor(endpoint: string) {
    this.endpoint = endpoint
  }

  async joinOrCreate(roomName: string, options: Record<string, unknown> = {}) {
    const roomId = roomName || 'public'
    const url = `${toWebSocketBase(this.endpoint)}/room/${encodeURIComponent(roomId)}`
    const socket = new WebSocket(url)
    const room = new CloudflareRoom(socket, roomId)

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        socket.close()
        reject(new Error('Timed out connecting to Cloudflare race room'))
      }, 10000)

      socket.addEventListener('open', () => {
        window.clearTimeout(timeout)
        socket.send(JSON.stringify({ type: 'join', ...options }))
        resolve()
      }, { once: true })

      socket.addEventListener('error', () => {
        window.clearTimeout(timeout)
        reject(new Error(`Could not connect to ${url}`))
      }, { once: true })
    })

    return room
  }
}
