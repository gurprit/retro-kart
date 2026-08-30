import Phaser from 'phaser'

const FAR_SCROLL_PER_TURN = 360
const NEAR_SCROLL_PER_TURN = 640
const FAR_BOTTOM_OFFSET = 52
const NEAR_BOTTOM_OFFSET = 14

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
    const farTexture = scene.textures.get(farTextureKey)
    const nearTexture = scene.textures.get(nearTextureKey)
    const farSource = farTexture.getSourceImage() as { width: number; height: number }
    const nearSource = nearTexture.getSourceImage() as { width: number; height: number }

    // Keep each TileSprite exactly one source-image tall. A taller TileSprite
    // repeats the texture vertically, which caused the duplicated mountain rows
    // and dark separator bands seen in the previous build.
    this.farLayer = scene.add
      .tileSprite(
        width / 2,
        horizonY - FAR_BOTTOM_OFFSET,
        width,
        farSource.height,
        farTextureKey,
      )
      .setOrigin(0.5, 1)
      .setDepth(2)

    this.nearLayer = scene.add
      .tileSprite(
        width / 2,
        horizonY - NEAR_BOTTOM_OFFSET,
        width,
        nearSource.height,
        nearTextureKey,
      )
      .setOrigin(0.5, 1)
      .setDepth(3)

    this.farLayer.setTileScale(1, 1)
    this.nearLayer.setTileScale(1, 1)
  }

  update(angle: number) {
    const turns = angle / (Math.PI * 2)
    this.farLayer.tilePositionX = turns * FAR_SCROLL_PER_TURN
    this.nearLayer.tilePositionX = turns * NEAR_SCROLL_PER_TURN
  }
}
