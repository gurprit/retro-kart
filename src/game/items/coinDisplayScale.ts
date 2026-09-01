import Phaser from 'phaser'

const TRACK_COIN_SCALE = 3
const originalSetDisplaySize = Phaser.GameObjects.Image.prototype.setDisplaySize

Phaser.GameObjects.Image.prototype.setDisplaySize = function setDisplaySize(
  width: number,
  height: number,
) {
  const textureKey = this.texture?.key ?? ''
  const isWorldCoin = textureKey.startsWith('retro-kart-coin-frame-') && this.depth < 20

  return originalSetDisplaySize.call(
    this,
    isWorldCoin ? width * TRACK_COIN_SCALE : width,
    isWorldCoin ? height * TRACK_COIN_SCALE : height,
  )
}
