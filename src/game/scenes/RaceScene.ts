import Phaser from 'phaser'
import { PlayerKart } from '../entities/PlayerKart'
import { SkidEffects } from '../effects/SkidEffects'
import { ItemSystem } from '../items/ItemSystem'
import {
  Mode7Renderer,
  type Mode7CameraState,
} from '../rendering/Mode7Renderer'
import { ParallaxBackground } from '../rendering/ParallaxBackground'
import { RacerSpriteView } from '../rendering/RacerSpriteView'
import {
  TrackSurfaceMap,
  type TrackSurface,
} from '../tracks/TrackSurfaceMap'

const GAME_WIDTH = 800
const GAME_HEIGHT = 600
const HORIZON_Y = 250
const GROUND_HEIGHT = GAME_HEIGHT - HORIZON_Y
const TRACK_TEXTURE_KEY = 'prototype-track'
const COLLISION_TEXTURE_KEY = 'prototype-collision'
const RACER_TEXTURE_KEY = 'prototype-racer'
const ITEM_ROULETTE_TEXTURE_KEY = 'item-roulette'
const PARTICLE_SHEET_URL = '/assets/effects/Particles.png'
const FAR_BACKGROUND_TEXTURE_KEY = 'prototype-far-background'
const NEAR_BACKGROUND_TEXTURE_KEY = 'prototype-near-background'
const HARD_COLLISION_SPIN_SPEED = 0.48

const START_GRID = {
  xRatio: 0.91,
  yRatio: 0.66,
  heading: 0,
} as const

const SURFACE_HANDLING = {
  road: { speedMultiplier: 1, gripMultiplier: 1, dragMultiplier: 1 },
  offRoad: { speedMultiplier: 0.58, gripMultiplier: 0.7, dragMultiplier: 2.2 },
  barrier: { speedMultiplier: 0.4, gripMultiplier: 0.6, dragMultiplier: 3 },
  void: { speedMultiplier: 0.42, gripMultiplier: 0.55, dragMultiplier: 2.8 },
} as const

export class RaceScene extends Phaser.Scene {
  private mode7Renderer?: Mode7Renderer
  private parallaxBackground?: ParallaxBackground
  private playerKart?: PlayerKart
  private racerSprite?: RacerSpriteView
  private skidEffects?: SkidEffects
  private itemSystem?: ItemSystem
  private trackSurfaceMap?: TrackSurfaceMap
  private speedText?: Phaser.GameObjects.Text
  private surfaceText?: Phaser.GameObjects.Text
  private currentSurface: TrackSurface = 'road'

  private cameraState: Mode7CameraState = {
    x: 0,
    y: 0,
    angle: START_GRID.heading,
  }

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
  private slideKey?: Phaser.Input.Keyboard.Key
  private useItemKey?: Phaser.Input.Keyboard.Key
  private wasd?: {
    up: Phaser.Input.Keyboard.Key
    down: Phaser.Input.Keyboard.Key
    left: Phaser.Input.Keyboard.Key
    right: Phaser.Input.Keyboard.Key
  }

  constructor() {
    super('RaceScene')
  }

  preload() {
    this.load.image(TRACK_TEXTURE_KEY, '/assets/tracks/Mario Circuit 1.png')
    this.load.image(COLLISION_TEXTURE_KEY, '/assets/tracks/Mario Circuit 1 - Collision.png')
    this.load.image(FAR_BACKGROUND_TEXTURE_KEY, '/assets/backgrounds/Mario Circuit 1 - Far Background.png')
    this.load.image(NEAR_BACKGROUND_TEXTURE_KEY, '/assets/backgrounds/Mario Circuit 1 - Near Background.png')
    this.load.image(RACER_TEXTURE_KEY, '/assets/characters/Racers - Mario.png')
    this.load.image(ITEM_ROULETTE_TEXTURE_KEY, '/assets/items/Item Roulette.png')
  }

  create() {
    this.cameras.main.setBackgroundColor('#67b7e8')
    this.add.rectangle(GAME_WIDTH / 2, HORIZON_Y / 2, GAME_WIDTH, HORIZON_Y, 0x67b7e8)

    this.parallaxBackground = new ParallaxBackground(
      this,
      FAR_BACKGROUND_TEXTURE_KEY,
      NEAR_BACKGROUND_TEXTURE_KEY,
      GAME_WIDTH,
      HORIZON_Y,
    )

    this.add
      .rectangle(GAME_WIDTH / 2, HORIZON_Y - 8, GAME_WIDTH, 16, 0x4e8d47)
      .setDepth(4)

    this.mode7Renderer = new Mode7Renderer(
      this,
      TRACK_TEXTURE_KEY,
      GAME_WIDTH,
      GROUND_HEIGHT,
      0,
      HORIZON_Y,
    )

    this.trackSurfaceMap = new TrackSurfaceMap(
      this,
      TRACK_TEXTURE_KEY,
      COLLISION_TEXTURE_KEY,
    )

    const worldScale = Math.min(
      this.mode7Renderer.sourceWidth,
      this.mode7Renderer.sourceHeight,
    )

    this.playerKart = new PlayerKart(
      this.mode7Renderer.sourceWidth * START_GRID.xRatio,
      this.mode7Renderer.sourceHeight * START_GRID.yRatio,
      START_GRID.heading,
      worldScale,
    )

    this.currentSurface = this.trackSurfaceMap.sample(this.playerKart.x, this.playerKart.y)

    this.syncCameraToKart()
    this.createKeyboardControls()
    this.createHud()

    this.racerSprite = new RacerSpriteView(
      this,
      RACER_TEXTURE_KEY,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 42,
    )

    this.skidEffects = new SkidEffects(
      this,
      PARTICLE_SHEET_URL,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 42,
    )

    this.itemSystem = new ItemSystem(
      this,
      this.mode7Renderer,
      worldScale,
      ITEM_ROULETTE_TEXTURE_KEY,
    )

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.itemSystem?.destroy()
      this.itemSystem = undefined
    })

    this.parallaxBackground.update(this.cameraState.angle)
    this.mode7Renderer.render(this.cameraState)
    this.itemSystem.update(this.playerKart.x, this.playerKart.y, this.cameraState)
    this.updateHud()
  }

  update(_time: number, delta: number) {
    if (
      !this.mode7Renderer ||
      !this.playerKart ||
      !this.trackSurfaceMap ||
      !this.cursors ||
      !this.wasd
    ) {
      return
    }

    const deltaSeconds = Math.min(delta / 1000, 0.05)
    const steerLeft = this.cursors.left.isDown || this.wasd.left.isDown
    const steerRight = this.cursors.right.isDown || this.wasd.right.isDown
    const powerslide = this.slideKey?.isDown ?? false

    this.currentSurface = this.trackSurfaceMap.sample(this.playerKart.x, this.playerKart.y)
    const previousX = this.playerKart.x
    const previousY = this.playerKart.y

    this.playerKart.update(
      {
        accelerate: this.cursors.up.isDown || this.wasd.up.isDown,
        brake: this.cursors.down.isDown || this.wasd.down.isDown,
        steerLeft,
        steerRight,
        powerslide,
      },
      deltaSeconds,
      SURFACE_HANDLING[this.currentSurface],
    )

    const nextSurface = this.trackSurfaceMap.sample(this.playerKart.x, this.playerKart.y)
    if (nextSurface === 'barrier' || nextSurface === 'void') {
      const impactSpeed = Math.abs(this.playerKart.speed)
      this.playerKart.x = previousX
      this.playerKart.y = previousY
      this.playerKart.applyCollision()
      if (impactSpeed >= HARD_COLLISION_SPIN_SPEED) this.racerSprite?.triggerSpin()
    } else {
      this.currentSurface = nextSurface
    }

    this.syncCameraToKart()
    this.parallaxBackground?.update(this.cameraState.angle)

    if (this.useItemKey && Phaser.Input.Keyboard.JustDown(this.useItemKey)) {
      this.itemSystem?.useHeldItem()
    }

    this.itemSystem?.update(this.playerKart.x, this.playerKart.y, this.cameraState)
    this.mode7Renderer.render(this.cameraState)

    this.racerSprite?.update(
      this.playerKart.steerVisual,
      this.currentSurface,
      this.playerKart.speed,
      delta,
    )

    this.skidEffects?.update(
      this.playerKart.state,
      this.playerKart.steerVisual,
      this.playerKart.speed,
      delta,
    )

    this.updateHud()
  }

  private syncCameraToKart() {
    if (!this.playerKart || !this.mode7Renderer) return
    const forwardX = Math.sin(this.playerKart.heading)
    const forwardY = -Math.cos(this.playerKart.heading)
    this.cameraState.x = this.playerKart.x - forwardX * this.mode7Renderer.groundContactDistance
    this.cameraState.y = this.playerKart.y - forwardY * this.mode7Renderer.groundContactDistance
    this.cameraState.angle = this.playerKart.heading
  }

  private createKeyboardControls() {
    const keyboard = this.input.keyboard
    if (!keyboard) return
    this.cursors = keyboard.createCursorKeys()
    this.wasd = keyboard.addKeys('W,S,A,D') as typeof this.wasd
    this.slideKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)
    this.useItemKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)
  }

  private createHud() {
    this.add
      .text(18, 16, 'RETRO KART // ITEMS TEST', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setDepth(30)

    this.add
      .text(18, 42, 'UP/DOWN OR W/S DRIVE   LEFT/RIGHT OR A/D STEER   SHIFT POWERSLIDE   SPACE USE ITEM', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setDepth(30)

    this.speedText = this.add
      .text(18, 68, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setDepth(30)

    this.surfaceText = this.add
      .text(18, 90, '', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setDepth(30)
  }

  private updateHud() {
    if (!this.playerKart) return
    this.speedText?.setText(`SPEED ${Math.round(Math.abs(this.playerKart.speed) * 100)}`)
    this.surfaceText?.setText(`SURFACE ${this.currentSurface.toUpperCase()}`)
  }
}
