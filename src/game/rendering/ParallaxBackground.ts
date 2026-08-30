import Phaser from 'phaser'

export class ParallaxBackground {
  private readonly farLayer: Phaser.GameObjects.TileSprite
  private readonly nearLayer: Phaser.GameObjects.TileSprite

  constructor(
    scene: Phaser.Scene,
    farTextureKey: string,
    nearTextureKey: string,
    width: number,
    horizonY: number,
  ) {
    this.farLayer = scene.add
      .tileSprite(width / 2, horizonY - 76, width, 72, farTextureKey)
      .setOrigin(0.5, 1)
      .setDepth(2)

    this.nearLayer = scene.add
      .tileSprite(width / 2, horizonY - 18, width, 56, nearTextureKey)
      .setOrigin(0.5, 1)
      .setDepth(3)
  }

  update(angle: number) {
    const turns = angle / (Math.PI * 2)
    this.farLayer.tilePositionX = turns * 460
    this.nearLayer.tilePositionX = turns * 900
  }
}
