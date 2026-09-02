import { ServerCpuSimulation } from './ServerCpuSimulation'
import { ServerTrackMap } from './ServerTrackMap'

export type ServerWorldItemKind =
  | 'banana'
  | 'bomb'
  | 'fireball'
  | 'greenShell'
  | 'redShell'

export type ServerWorldItemSnapshot = {
  id: string
  item: ServerWorldItemKind
  ownerId: string
  x: number
  y: number
  vx: number
  vy: number
  ttl: number
  age: number
}

export type HumanItemTarget = {
  id: string
  x: number
  y: number
  invulnerable: boolean
}

export type ServerItemHit = {
  itemId: string
  item: ServerWorldItemKind
  ownerId: string
  targetId: string
  targetType: 'human' | 'cpu'
  blastX: number
  blastY: number
  pushStrength: number
  controlLockSeconds: number
}

export type ServerItemExplosion = {
  itemId: string
  x: number
  y: number
}

type ServerWorldItem = ServerWorldItemSnapshot & {
  ownerGrace: number
  fuse?: number
}

const WORLD_ITEM_HIT_RADIUS_RATIO = 0.025
const BANANA_DROP_DISTANCE_RATIO = 0.026
const PROJECTILE_START_DISTANCE_RATIO = 0.055
const SHELL_SPEED_RATIO = 0.62
const FIREBALL_SPEED_RATIO = 0.68
const BOMB_THROW_SPEED_RATIO = 0.24
const BOMB_FUSE_SECONDS = 1.05
const BOMB_BLAST_RADIUS_RATIO = 0.145
const BOMB_PUSH_STRENGTH_RATIO = 0.22
const BOMB_CONTROL_LOCK_SECONDS = 1.05
const PROJECTILE_CONTROL_LOCK_SECONDS = 0.72
const PROJECTILE_PUSH_RATIO = 0.105

export class ServerItemSimulation {
  private readonly items = new Map<string, ServerWorldItem>()
  private readonly worldScale: number
  private readonly hitRadius: number
  private pendingHits: ServerItemHit[] = []
  private pendingExplosions: ServerItemExplosion[] = []

  constructor(
    private readonly track: ServerTrackMap,
    private readonly cpus: ServerCpuSimulation,
    private readonly getHumans: () => readonly HumanItemTarget[],
  ) {
    this.worldScale = Math.min(track.width, track.height)
    this.hitRadius = this.worldScale * WORLD_ITEM_HIT_RADIUS_RATIO
  }

  spawn(
    id: string,
    ownerId: string,
    item: ServerWorldItemKind,
    x: number,
    y: number,
    angle: number,
  ) {
    if (this.items.has(id)) return this.items.get(id)

    const forwardX = Math.sin(angle)
    const forwardY = -Math.cos(angle)
    let worldX = x
    let worldY = y
    let vx = 0
    let vy = 0
    let ttl = 1
    let ownerGrace = 0.45
    let fuse: number | undefined

    if (item === 'banana') {
      const distance = this.worldScale * BANANA_DROP_DISTANCE_RATIO
      worldX += forwardX * distance
      worldY += forwardY * distance
      ttl = 14
      ownerGrace = 0.9
    } else if (item === 'bomb') {
      const distance = this.worldScale * PROJECTILE_START_DISTANCE_RATIO
      const speed = this.worldScale * BOMB_THROW_SPEED_RATIO
      worldX += forwardX * distance
      worldY += forwardY * distance
      vx = forwardX * speed
      vy = forwardY * speed
      ttl = BOMB_FUSE_SECONDS + 0.1
      ownerGrace = 0.25
      fuse = BOMB_FUSE_SECONDS
    } else {
      const distance = this.worldScale * PROJECTILE_START_DISTANCE_RATIO
      const speedRatio =
        item === 'fireball'
          ? FIREBALL_SPEED_RATIO
          : item === 'redShell'
            ? SHELL_SPEED_RATIO * 0.93
            : SHELL_SPEED_RATIO
      const speed = this.worldScale * speedRatio
      worldX += forwardX * distance
      worldY += forwardY * distance
      vx = forwardX * speed
      vy = forwardY * speed
      ttl = item === 'fireball' ? 4 : 7
    }

    const worldItem: ServerWorldItem = {
      id,
      item,
      ownerId,
      x: worldX,
      y: worldY,
      vx,
      vy,
      ttl,
      age: 0,
      ownerGrace,
      fuse,
    }
    this.items.set(id, worldItem)
    return worldItem
  }

  update(deltaSeconds: number) {
    this.pendingHits = []
    this.pendingExplosions = []

    for (const [id, item] of this.items) {
      item.age += deltaSeconds
      item.ttl -= deltaSeconds
      item.ownerGrace = Math.max(0, item.ownerGrace - deltaSeconds)

      if (item.item === 'bomb') {
        item.fuse = Math.max(0, (item.fuse ?? 0) - deltaSeconds)
        item.x += item.vx * deltaSeconds
        item.y += item.vy * deltaSeconds
        item.vx *= Math.pow(0.06, deltaSeconds)
        item.vy *= Math.pow(0.06, deltaSeconds)

        if ((item.fuse ?? 0) <= 0) {
          this.detonateBomb(item)
          this.items.delete(id)
          continue
        }
      } else if (item.item !== 'banana') {
        this.updateProjectile(item, deltaSeconds)
      }

      if (item.ttl <= 0) {
        this.items.delete(id)
        continue
      }

      if (this.checkHits(item)) this.items.delete(id)
    }
  }

  get snapshots(): ServerWorldItemSnapshot[] {
    return [...this.items.values()].map(({ ownerGrace: _ownerGrace, fuse: _fuse, ...item }) => ({
      ...item,
    }))
  }

  consumeHits() {
    const hits = this.pendingHits
    this.pendingHits = []
    return hits
  }

  consumeExplosions() {
    const explosions = this.pendingExplosions
    this.pendingExplosions = []
    return explosions
  }

  private updateProjectile(item: ServerWorldItem, deltaSeconds: number) {
    if (item.item === 'redShell') this.homeRedShell(item, deltaSeconds)

    const nextX = item.x + item.vx * deltaSeconds
    const nextY = item.y + item.vy * deltaSeconds
    if (this.track.sample(nextX, nextY) === 'barrier') {
      if (item.item === 'greenShell') {
        const hitX = this.track.sample(nextX, item.y) === 'barrier'
        const hitY = this.track.sample(item.x, nextY) === 'barrier'
        if (hitX || (!hitX && !hitY)) item.vx *= -1
        if (hitY || (!hitX && !hitY)) item.vy *= -1
        item.x += item.vx * deltaSeconds
        item.y += item.vy * deltaSeconds
      } else {
        item.ttl = 0
      }
      return
    }

    item.x = nextX
    item.y = nextY
  }

  private homeRedShell(item: ServerWorldItem, deltaSeconds: number) {
    const targets = this.getTargets(item.ownerId)
      .sort((a, b) => this.distanceSq(a.x, a.y, item.x, item.y) - this.distanceSq(b.x, b.y, item.x, item.y))
    const target = targets[0]
    if (!target) return

    const speed = Math.hypot(item.vx, item.vy)
    const dx = target.x - item.x
    const dy = target.y - item.y
    const length = Math.max(0.001, Math.hypot(dx, dy))
    const desiredVx = (dx / length) * speed
    const desiredVy = (dy / length) * speed
    const follow = Math.min(1, deltaSeconds * 3.8)
    item.vx = this.lerp(item.vx, desiredVx, follow)
    item.vy = this.lerp(item.vy, desiredVy, follow)
  }

  private checkHits(item: ServerWorldItem) {
    const hitRadiusSq = this.hitRadius * this.hitRadius

    for (const target of this.getTargets()) {
      if (target.id === item.ownerId && item.ownerGrace > 0) continue
      if (this.distanceSq(target.x, target.y, item.x, item.y) > hitRadiusSq) continue

      if (item.item === 'bomb') {
        this.detonateBomb(item)
        return true
      }

      if (target.invulnerable) return true

      this.applyHit(
        item,
        target,
        item.x,
        item.y,
        this.worldScale * PROJECTILE_PUSH_RATIO,
        item.item === 'banana' ? 0.95 : PROJECTILE_CONTROL_LOCK_SECONDS,
      )
      return true
    }

    return false
  }

  private detonateBomb(item: ServerWorldItem) {
    const radius = this.worldScale * BOMB_BLAST_RADIUS_RATIO
    const radiusSq = radius * radius
    const pushStrength = this.worldScale * BOMB_PUSH_STRENGTH_RATIO

    for (const target of this.getTargets()) {
      if (target.invulnerable) continue
      if (this.distanceSq(target.x, target.y, item.x, item.y) > radiusSq) continue
      this.applyHit(
        item,
        target,
        item.x,
        item.y,
        pushStrength,
        BOMB_CONTROL_LOCK_SECONDS,
      )
    }

    this.pendingExplosions.push({ itemId: item.id, x: item.x, y: item.y })
  }

  private applyHit(
    item: ServerWorldItem,
    target: HumanItemTarget & { targetType: 'human' | 'cpu' },
    blastX: number,
    blastY: number,
    pushStrength: number,
    controlLockSeconds: number,
  ) {
    if (target.targetType === 'cpu') {
      this.cpus.spinOut(target.id, blastX, blastY, pushStrength, controlLockSeconds)
    }

    this.pendingHits.push({
      itemId: item.id,
      item: item.item,
      ownerId: item.ownerId,
      targetId: target.id,
      targetType: target.targetType,
      blastX,
      blastY,
      pushStrength,
      controlLockSeconds,
    })
  }

  private getTargets(excludeId?: string) {
    const humans = this.getHumans().map((human) => ({ ...human, targetType: 'human' as const }))
    const cpus = this.cpus.itemStates.map((cpu) => ({ ...cpu, targetType: 'cpu' as const }))
    const targets = [...humans, ...cpus]
    return excludeId ? targets.filter((target) => target.id !== excludeId) : targets
  }

  private distanceSq(ax: number, ay: number, bx: number, by: number) {
    const dx = ax - bx
    const dy = ay - by
    return dx * dx + dy * dy
  }

  private lerp(from: number, to: number, amount: number) {
    return from + (to - from) * amount
  }
}
