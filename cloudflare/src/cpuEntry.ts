import worker, { RaceRoom as BaseRaceRoom } from './index'
import { CpuItemDirector } from './CpuItemDirector'

// Keep the proven room transport/simulation intact and layer CPU item behaviour on
// top. BaseRaceRoom's methods are ordinary JavaScript methods at runtime, so using
// an `any` base here lets us extend the existing room without duplicating it while
// the Cloudflare migration is still settling.
const RoomBase: any = BaseRaceRoom

export default {
  async fetch(request: Request, env: unknown): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        ok: true,
        service: 'retro-kart-multiplayer',
        transport: 'cloudflare-durable-objects',
        simulation: 'cpu+cpu-items+items+coins',
        cpuItems: true,
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      })
    }
    return worker.fetch(request, env as never)
  },
}

export class RaceRoom extends RoomBase {
  private readonly cpuItemDirector: CpuItemDirector

  constructor(state: any) {
    super(state)
    const room = this as any
    const track = room.cpuSimulation?.track ?? undefined

    // ServerCpuSimulation keeps its track private, so dimensions are taken from
    // the same generated track constants exposed by the active simulations.
    const width = room.coinSimulation?.track?.width ?? 1026
    const height = room.coinSimulation?.track?.height ?? 1028

    this.cpuItemDirector = new CpuItemDirector(
      width,
      height,
      room.cpuSimulation,
      room.itemSimulation,
      {
        getHumans: () => room.getHumanItemTargets(),
        broadcast: (payload) => room.broadcast(payload),
        activateLightning: (ownerId) => room.activateLightning(ownerId),
        applyStarHit: (ownerId, blastX, blastY, targetId, targetType, now) =>
          room.applyStarContact(ownerId, blastX, blastY, targetId, targetType, now),
      },
    )

    void track
  }

  tick() {
    super.tick()
    this.cpuItemDirector?.update(Date.now())
  }
}
