import Phaser from 'phaser'

const FAR_SCROLL_PER_TURN = 280
const NEAR_SCROLL_PER_TURN = 620
const FAR_SCALE = 0.82
const NEAR_SCALE = 1
const BACKGROUND_BOTTOM_OFFSET = 8

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

    const farHeight = Math.max(1, Math.round(farSource.height * FAR_SCALE))
    const nearHeight = Math.max(1, Math.round(nearSource.height * NEAR_SCALE))
    const sharedBottomY = horizonY - BACKGROUND_BOTTOM_OFFSET

    // Both scenery strips share the same baseline so their source artwork
    // overlays exactly as intended. Parallax comes only from horizontal motion:
    // the distant layer moves slowly while the foreground layer moves faster.
    this.farLayer = scene.add
      .tileSprite(
        width / 2,
        sharedBottomY,
        width,
        farHeight,
        farTextureKey,
      )
      .setOrigin(0.5, 1)
      .setDepth(1)

    this.nearLayer = scene.add
      .tileSprite(
        width / 2,
        sharedBottomY,
        width,
        nearHeight,
        nearTextureKey,
      )
      .setOrigin(0.5, 1)
      .setDepth(2)

    this.farLayer.setTileScale(FAR_SCALE, FAR_SCALE)
    this.nearLayer.setTileScale(NEAR_SCALE, NEAR_SCALE)
  }

  update(angle: number) {
    const turns = angle / (Math.PI * 2)

    this.farLayer.tilePositionX = turns * FAR_SCROLL_PER_TURN
    this.nearLayer.tilePositionX = turns * NEAR_SCROLL_PER_TURN
  }
}
