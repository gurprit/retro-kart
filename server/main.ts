import { defineRoom, defineServer, Room, type Client } from 'colyseus'

type KartSnapshot = {
  id: string
  racerKey: string
  x: number
  y: number
  angle: number
  speedRatio: number
}

type CpuSnapshot = {
  id: string
  x: number
  y: number
  angle: number
  speedRatio: number
  steering: number
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
  private simulationHostId?: string
  private latestCpuSnapshots: CpuSnapshot[] = []

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

    this.onMessage('cpus', (client, payload: CpuSnapshot[]) => {
      if (client.sessionId !== this.simulationHostId || !Array.isArray(payload)) return

      this.latestCpuSnapshots = payload
        .slice(0, 20)
        .filter((cpu) => cpu && typeof cpu.id === 'string')
        .map((cpu) => ({
          id: cpu.id,
          x: Number(cpu.x) || 0,
          y: Number(cpu.y) || 0,
          angle: Number(cpu.angle) || 0,
          speedRatio: Number(cpu.speedRatio) || 0,
          steering: Number(cpu.steering) || 0,
        }))

      this.broadcast('cpus', this.latestCpuSnapshots, { except: client })
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

    if (!this.simulationHostId) this.simulationHostId = client.sessionId
    this.broadcast('simulation-host', { id: this.simulationHostId })
    if (this.latestCpuSnapshots.length > 0) client.send('cpus', this.latestCpuSnapshots)

    console.log(
      `[retro_kart] ${client.sessionId} joined (${this.clients.length}/${this.maxClients})` +
        (client.sessionId === this.simulationHostId ? ' [simulation host]' : ''),
    )
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId)
    this.broadcast('player-left', { id: client.sessionId })

    if (client.sessionId === this.simulationHostId) {
      const nextHost = this.clients.find((candidate) => candidate.sessionId !== client.sessionId)
      this.simulationHostId = nextHost?.sessionId
      this.broadcast('simulation-host', { id: this.simulationHostId ?? null })
      console.log(`[retro_kart] simulation host -> ${this.simulationHostId ?? 'none'}`)
    }

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
