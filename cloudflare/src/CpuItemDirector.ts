import type { ServerCpuSimulation } from '../../server/ServerCpuSimulation'
import type {
  ServerItemSimulation,
  ServerWorldItemKind,
} from '../../server/ServerItemSimulation'

export type CpuItemType =
  | 'banana'
  | 'bomb'
  | 'coin'
  | 'fireball'
  | 'greenShell'
  | 'redShell'
  | 'mushroom'
  | 'star'

export type CpuItemHuman = {
  id: string
  x: number
  y: number
  invulnerable: boolean
}

type HeldItem = {
  item: CpuItemType
  pickedUpAt: number
  useAfter: number
  forceUseAt: number
}

type ItemBox = {
  id: string
  x: number
  y: number
  active: boolean
  respawnAt: number
}

type RacerTarget = {
  id: string
  x: number
  y: number
  invulnerable: boolean
  targetType: 'human' | 'cpu'
}

export type CpuItemDirectorCallbacks = {
  getHumans: () => readonly CpuItemHuman[]
  broadcast: (payload: unknown) => void
  activateLightning: (ownerId: string) => void
  applyStarHit: (
    ownerId: string,
    blastX: number,
    blastY: number,
    targetId: string,
    targetType: 'human' | 'cpu',
    now: number,
  ) => void
}

const ITEM_BOX_RATIOS = [
  // Upper-right straight / first corner.
  { id: 'mc1-1', xRatio: 0.83, yRatio: 0.50 },
  { id: 'mc1-2', xRatio: 0.87, yRatio: 0.50 },
  { id: 'mc1-3', xRatio: 0.91, yRatio: 0.50 },
  { id: 'mc1-4', xRatio: 0.95, yRatio: 0.50 },
  { id: 'mc1-5', xRatio: 0.99, yRatio: 0.50 },

  // Top section.
  { id: 'mc1-6', xRatio: 0.68, yRatio: 0.445 },
  { id: 'mc1-7', xRatio: 0.64, yRatio: 0.435 },
  { id: 'mc1-8', xRatio: 0.60, yRatio: 0.425 },
  { id: 'mc1-9', xRatio: 0.56, yRatio: 0.420 },
  { id: 'mc1-10', xRatio: 0.52, yRatio: 0.420 },

  // Left-hand section.
  { id: 'mc1-11', xRatio: 0.405, yRatio: 0.465 },
  { id: 'mc1-12', xRatio: 0.370, yRatio: 0.490 },
  { id: 'mc1-13', xRatio: 0.340, yRatio: 0.520 },
  { id: 'mc1-14', xRatio: 0.315, yRatio: 0.555 },
  { id: 'mc1-15', xRatio: 0.305, yRatio: 0.590 },

  // Bottom-left / bottom section.
  { id: 'mc1-16', xRatio: 0.405, yRatio: 0.655 },
  { id: 'mc1-17', xRatio: 0.455, yRatio: 0.675 },
  { id: 'mc1-18', xRatio: 0.510, yRatio: 0.682 },
  { id: 'mc1-19', xRatio: 0.565, yRatio: 0.684 },
  { id: 'mc1-20', xRatio: 0.620, yRatio: 0.680 },

  // Bottom-right approach back toward the start straight.
  { id: 'mc1-21', xRatio: 0.685, yRatio: 0.675 },
  { id: 'mc1-22', xRatio: 0.735, yRatio: 0.665 },
  { id: 'mc1-23', xRatio: 0.785, yRatio: 0.650 },
  { id: 'mc1-24', xRatio: 0.835, yRatio: 0.625 },
  { id: 'mc1-25', xRatio: 0.875, yRatio: 0.590 },
] as const

const ITEM_POOL: CpuItemType[] = [
  'banana',
  'banana',
  'greenShell',
  'greenShell',
  'redShell',
  'redShell',
  'mushroom',
  'mushroom',
  'coin',
  'coin',
  'bomb',
  'fireball',
  'star',
]

const WORLD_ITEMS = new Set<ServerWorldItemKind>([
  'banana',
  'bomb',
  'fireball',
  'greenShell',
  'redShell',
])

const ITEM_BOX_RESPAWN_MS = 5000
const PICKUP_RADIUS_RATIO = 0.035
const TARGET_RANGE_RATIO = 0.34
const CLOSE_TARGET_RANGE_RATIO = 0.2
const STAR_CONTACT_RADIUS_RATIO = 0.036
const CPU_STAR_DURATION_SECONDS = 6
const MUSHROOM_MULTIPLIER = 1.55
const MUSHROOM_DURATION_SECONDS = 0.9

export class CpuItemDirector {
  private readonly held = new Map<string, HeldItem>()
  private readonly cpuStarUntil = new Map<string, number>()
  private readonly itemBoxes: ItemBox[]
  private readonly pickupRadiusSq: number
  private readonly targetRangeSq: number
  private readonly closeTargetRangeSq: number
  private readonly starContactRadiusSq: number
  private nextItemId = 1

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly cpus: ServerCpuSimulation,
    private readonly items: ServerItemSimulation,
    private readonly callbacks: CpuItemDirectorCallbacks,
  ) {
    const worldScale = Math.min(width, height)
    this.pickupRadiusSq = Math.pow(worldScale * PICKUP_RADIUS_RATIO, 2)
    this.targetRangeSq = Math.pow(worldScale * TARGET_RANGE_RATIO, 2)
    this.closeTargetRangeSq = Math.pow(worldScale * CLOSE_TARGET_RANGE_RATIO, 2)
    this.starContactRadiusSq = Math.pow(worldScale * STAR_CONTACT_RADIUS_RATIO, 2)
    this.itemBoxes = ITEM_BOX_RATIOS.map((box) => ({
      id: box.id,
      x: width * box.xRatio,
      y: height * box.yRatio,
      active: true,
      respawnAt: 0,
    }))
  }

  update(now: number) {
    this.respawnBoxes(now)
    this.collectBoxes(now)
    this.useHeldItems(now)
    this.resolveCpuStarContacts(now)

    for (const [id, expiresAt] of this.cpuStarUntil) {
      if (expiresAt <= now) this.cpuStarUntil.delete(id)
    }
  }

  get boxSnapshots() {
    return this.itemBoxes.map(({ id, x, y, active }) => ({ id, x, y, active }))
  }

  private respawnBoxes(now: number) {
    for (const box of this.itemBoxes) {
      if (!box.active && box.respawnAt <= now) {
        box.active = true
        box.respawnAt = 0
      }
    }
  }

  private collectBoxes(now: number) {
    for (const cpu of this.cpus.snapshots) {
      if (this.held.has(cpu.id)) continue

      const box = this.itemBoxes.find((candidate) => {
        if (!candidate.active) return false
        return this.distanceSq(cpu.x, cpu.y, candidate.x, candidate.y) <= this.pickupRadiusSq
      })
      if (!box) continue

      box.active = false
      box.respawnAt = now + ITEM_BOX_RESPAWN_MS
      const item = ITEM_POOL[Math.floor(Math.random() * ITEM_POOL.length)]
      const reactionMs = 550 + Math.random() * 1250
      this.held.set(cpu.id, {
        item,
        pickedUpAt: now,
        useAfter: now + reactionMs,
        forceUseAt: now + 3500 + Math.random() * 3500,
      })
      this.callbacks.broadcast({
        type: 'cpu-item-picked-up',
        event: { ownerId: cpu.id, item, boxId: box.id },
      })
    }
  }

  private useHeldItems(now: number) {
    const cpuSnapshots = this.cpus.snapshots
    for (const cpu of cpuSnapshots) {
      const held = this.held.get(cpu.id)
      if (!held || held.useAfter > now) continue

      const targets = this.targetsFor(cpu.id)
      const ahead = this.closestDirectionalTarget(cpu, targets, true)
      const behind = this.closestDirectionalTarget(cpu, targets, false)
      const nearest = this.closestTarget(cpu.x, cpu.y, targets)
      const forced = held.forceUseAt <= now

      let shouldUse = forced
      switch (held.item) {
        case 'greenShell':
        case 'redShell':
          shouldUse ||= !!ahead && ahead.distanceSq <= this.targetRangeSq
          break
        case 'banana':
          shouldUse ||= !!behind && behind.distanceSq <= this.closeTargetRangeSq
          break
        case 'bomb':
          shouldUse ||= !!nearest && nearest.distanceSq <= this.closeTargetRangeSq
          break
        case 'fireball':
          shouldUse ||= targets.length >= 2 || targets.some((target) => target.targetType === 'human')
          break
        case 'mushroom':
          shouldUse ||= Math.abs(cpu.speedRatio) < 0.88
          break
        case 'star':
        case 'coin':
          shouldUse = true
          break
      }

      if (!shouldUse) continue
      this.held.delete(cpu.id)
      this.activate(cpu, held.item, now)
    }
  }

  private activate(
    cpu: { id: string; x: number; y: number; angle: number; speedRatio: number },
    item: CpuItemType,
    now: number,
  ) {
    this.callbacks.broadcast({
      type: 'cpu-item-use',
      event: { ownerId: cpu.id, item, x: cpu.x, y: cpu.y, angle: cpu.angle },
    })

    if (item === 'mushroom') {
      this.cpus.boost(cpu.id, MUSHROOM_MULTIPLIER, MUSHROOM_DURATION_SECONDS)
      return
    }

    if (item === 'coin') {
      this.cpus.addCoin(cpu.id, 2)
      return
    }

    if (item === 'star') {
      this.cpus.grantStar(cpu.id, CPU_STAR_DURATION_SECONDS)
      this.cpuStarUntil.set(cpu.id, now + CPU_STAR_DURATION_SECONDS * 1000)
      this.callbacks.broadcast({
        type: 'star-activated',
        event: { ownerId: cpu.id, durationSeconds: CPU_STAR_DURATION_SECONDS },
      })
      return
    }

    if (item === 'fireball') {
      // A tiny grace-star makes the lightning owner immune to the CPU-wide shrink call.
      this.cpus.grantStar(cpu.id, 0.12)
      this.callbacks.activateLightning(cpu.id)
      return
    }

    if (WORLD_ITEMS.has(item as ServerWorldItemKind)) {
      const spawned = this.items.spawn(
        `cpu-item-${this.nextItemId++}`,
        cpu.id,
        item as ServerWorldItemKind,
        cpu.x,
        cpu.y,
        cpu.angle,
      )
      if (spawned) this.callbacks.broadcast({ type: 'item-spawn', snapshot: spawned })
    }
  }

  private resolveCpuStarContacts(now: number) {
    const starred = this.cpus.snapshots.filter((cpu) => (this.cpuStarUntil.get(cpu.id) ?? 0) > now)
    if (starred.length === 0) return

    const cpuStates = this.cpus.itemStates
    const humans = this.callbacks.getHumans()
    for (const attacker of starred) {
      for (const target of cpuStates) {
        if (target.id === attacker.id || target.invulnerable) continue
        if (this.distanceSq(attacker.x, attacker.y, target.x, target.y) > this.starContactRadiusSq) continue
        this.callbacks.applyStarHit(
          attacker.id,
          attacker.x,
          attacker.y,
          target.id,
          'cpu',
          now,
        )
      }

      for (const target of humans) {
        if (target.invulnerable) continue
        if (this.distanceSq(attacker.x, attacker.y, target.x, target.y) > this.starContactRadiusSq) continue
        this.callbacks.applyStarHit(
          attacker.id,
          attacker.x,
          attacker.y,
          target.id,
          'human',
          now,
        )
      }
    }
  }

  private targetsFor(ownerId: string): RacerTarget[] {
    return [
      ...this.callbacks.getHumans().map((human) => ({ ...human, targetType: 'human' as const })),
      ...this.cpus.itemStates.map((cpu) => ({ ...cpu, targetType: 'cpu' as const })),
    ].filter((target) => target.id !== ownerId)
  }

  private closestDirectionalTarget(
    cpu: { x: number; y: number; angle: number },
    targets: readonly RacerTarget[],
    ahead: boolean,
  ) {
    const forwardX = Math.sin(cpu.angle)
    const forwardY = -Math.cos(cpu.angle)
    let best: { target: RacerTarget; distanceSq: number } | undefined

    for (const target of targets) {
      const dx = target.x - cpu.x
      const dy = target.y - cpu.y
      const dot = dx * forwardX + dy * forwardY
      if ((ahead && dot <= 0) || (!ahead && dot >= 0)) continue
      const distanceSq = dx * dx + dy * dy
      if (!best || distanceSq < best.distanceSq) best = { target, distanceSq }
    }
    return best
  }

  private closestTarget(x: number, y: number, targets: readonly RacerTarget[]) {
    let best: { target: RacerTarget; distanceSq: number } | undefined
    for (const target of targets) {
      const distanceSq = this.distanceSq(x, y, target.x, target.y)
      if (!best || distanceSq < best.distanceSq) best = { target, distanceSq }
    }
    return best
  }

  private distanceSq(ax: number, ay: number, bx: number, by: number) {
    const dx = ax - bx
    const dy = ay - by
    return dx * dx + dy * dy
  }
}
