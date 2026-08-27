import Phaser from 'phaser'
import { RaceScene } from '../scenes/RaceScene'

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,

  width: 800,
  height: 600,

  parent: 'game',

  backgroundColor: '#111111',

  pixelArt: true,
  antialias: false,

  scene: [RaceScene],

  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
}
