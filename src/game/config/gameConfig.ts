import Phaser from 'phaser'
import { RaceScene } from '../scenes/RaceScene'

const BASE_RACE_HEIGHT = 600
const PORTRAIT_WIDTH = 800
const PORTRAIT_HEIGHT = 1040

const isTouchDevice =
  typeof navigator !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
const isPortrait =
  isTouchDevice && window.innerHeight > window.innerWidth

// Landscape uses the real browser aspect ratio so Mode 7 renders extra world
// at the sides instead of stretching the old 4:3 image. Portrait keeps a 4:3
// race screen at the top and reserves the lower canvas for handheld controls.
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
  height: isPortrait ? PORTRAIT_HEIGHT : BASE_RACE_HEIGHT,

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
