import Phaser from 'phaser'
import { RaceScene } from '../scenes/RaceScene'

const BASE_RACE_HEIGHT = 600
const PORTRAIT_WIDTH = 800

const isTouchDevice =
  typeof navigator !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
const isPortrait =
  isTouchDevice && window.innerHeight > window.innerWidth

// Match the portrait canvas to the actual browser viewport aspect ratio so the
// handheld body reaches the bottom of the usable screen instead of leaving a
// black strip underneath it.
const portraitHeight = isPortrait
  ? Phaser.Math.Clamp(
      Math.round(PORTRAIT_WIDTH * (window.innerHeight / window.innerWidth)),
      1180,
      1600,
    )
  : 1040

// Landscape uses the real browser aspect ratio so Mode 7 renders extra world
// at the sides instead of stretching the old 4:3 image.
const landscapeWidth = isTouchDevice
  ? Phaser.Math.Clamp(
      Math.round(BASE_RACE_HEIGHT * (window.innerWidth / window.innerHeight)),
      960,
      1360,
    )
  : 800

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,

  width: isPortrait ? PORTRAIT_WIDTH : landscapeWidth,
  height: isPortrait ? portraitHeight : BASE_RACE_HEIGHT,

  parent: 'game',

  backgroundColor: '#111111',

  pixelArt: true,
  antialias: false,

  scene: [RaceScene],

  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: isPortrait
      ? Phaser.Scale.CENTER_HORIZONTALLY
      : Phaser.Scale.CENTER_BOTH,
  },
}
