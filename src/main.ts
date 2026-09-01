import Phaser from 'phaser'
import { gameConfig } from './game/config/gameConfig'
import { installItemVisualFixes } from './game/items/installItemVisualFixes'

installItemVisualFixes()
new Phaser.Game(gameConfig)

const isTouchDevice =
  typeof navigator !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)

if (isTouchDevice) {
  const initialPortrait = window.innerHeight > window.innerWidth

  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => {
      const nextPortrait = window.innerHeight > window.innerWidth
      if (nextPortrait !== initialPortrait) {
        window.location.reload()
      }
    }, 150)
  })
}
