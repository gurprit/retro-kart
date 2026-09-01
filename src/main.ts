import Phaser from 'phaser'
import { gameConfig } from './game/config/gameConfig'
import { installBananaTransparency } from './game/items/installBananaTransparency'
import { installItemCourseEnhancements } from './game/items/installItemCourseEnhancements'
import { installItemVisualFixes } from './game/items/installItemVisualFixes'
import { installLightningPowerUp } from './game/items/installLightningPowerUp'
import { installWorldPickupParticles } from './game/items/installWorldPickupParticles'

installItemVisualFixes()
installBananaTransparency()
installItemCourseEnhancements()
installWorldPickupParticles()
installLightningPowerUp()
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
