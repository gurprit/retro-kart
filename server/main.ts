import { defineRoom, defineServer, Room, type Client } from 'colyseus'

type KartSnapshot = {
  id: string
  racerKey: string
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

class RetroKartRoom extends Room {
  maxClients = 21
  private readonly players = new Map<string, KartSnapshot>()

  onCreate() {
    this.onMessage('kart', (client, payload: Partial<KartSnapshot>) => {
      const player = this.players.get(client.sessionId)
      if (!player) return

      if (Number.isFinite(payload.x)) player.x = Number(payload.x)
      if (Number.isFinite(payload.y)) player.y = Number(payload.y)
      if (Number.isFinite(payload.angle)) player.angle = Number(payload.angle)
      if (Number.isFinite(payload.speedRatio)) {
        player.speedRatio = Number(payload.speedRatio)
      }

      this.broadcast('kart', player, { except: client })
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
    this.players.set(client.sessionId, player)
    this.broadcast('player-joined', player, { except: client })

    console.log(`[retro_kart] ${client.sessionId} joined (${this.clients.length}/${this.maxClients})`)
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
