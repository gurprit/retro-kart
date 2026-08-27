import Phaser from 'phaser'

const EMIT_INTERVAL = 0.045
const PARTICLE_LIFETIME = 0.28

export class SkidEffects {
  private readonly scene: Phaser.Scene
  private readonly x: number
  private readonly y: number
  private emitTimer = 0

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene
    this.x = x
    this.y = y
  }

  update(active: boolean, speedRatio: number, deltaSeconds: number) {
    if (!active) {
      this.emitTimer = 0
      return
    }

    this.emitTimer -= deltaSeconds

    if (this.emitTimer > 0) {
      return
    }

    this.emitTimer = EMIT_INTERVAL
    const intensity = Phaser.Math.Clamp(Math.abs(speedRatio), 0.2, 1)

    this.spawnPuff(-24, intensity)
    this.spawnPuff(24, intensity)
  }

  private spawnPuff(offsetX: number, intensity: number) {
    const puff = this.scene.add
      .rectangle(
        this.x + offsetX,
        this.y + 2,
        7 + intensity * 5,
        4 + intensity * 3,
        0xe6e1d6,
        0.7,
      )
      .setDepth(19)

    this.scene.tweens.add({
      targets: puff,
      x: puff.x + Phaser.Math.Between(-8, 8),
      y: puff.y + Phaser.Math.Between(8, 15),
      alpha: 0,
      scaleX: 1.7,
      scaleY: 1.7,
      duration: PARTICLE_LIFETIME * 1000,
      onComplete: () => puff.destroy(),
    })
  }
}
