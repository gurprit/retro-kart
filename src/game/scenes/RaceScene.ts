import Phaser from 'phaser'
import { PlayerKart } from '../entities/PlayerKart'
import {
  Mode7Renderer,
  type Mode7CameraState,
} from '../rendering/Mode7Renderer'
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
const RACER_TEXTURE_KEY = 'prototype-racer'

const SURFACE_HANDLING = {
  road: {
    speedMultiplier: 1,
    gripMultiplier: 1,
    dragMultiplier: 1,
  },
  offRoad: {
    speedMultiplier: 0.58,
    gripMultiplier: 0.7,
    dragMultiplier: 2.2,
  },
  void: {
    speedMultiplier: 0.42,
    gripMultiplier: 0.55,
    dragMultiplier: 2.8,
  },
} as const

export class RaceScene extends Phaser.Scene {
  private mode7Renderer?: Mode7Renderer
  private playerKart?: PlayerKart
  private racerSprite?: RacerSpriteView
  private trackSurfaceMap?: TrackSurfaceMap
  private speedText?: Phaser.GameObjects.Text
  private surfaceText?: Phaser.GameObjects.Text
  private currentSurface: TrackSurface = 'road'

  private cameraState: Mode7CameraState = {
    x: 0,
    y: 0,
    angle: Math.PI / 2,
  }

  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys
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
    this.load.image(
      TRACK_TEXTURE_KEY,
      '/assets/tracks/Mario Circuit 1.png',
    )

    this.load.image(
      RACER_TEXTURE_KEY,
      '/assets/characters/Racers - Mario.png',
    )
  }

  create() {
    this.cameras.main.setBackgroundColor('#67b7e8')

    this.add.rectangle(
      GAME_WIDTH / 2,
      HORIZON_Y / 2,
      GAME_WIDTH,
      HORIZON_Y,
      0x67b7e8,
    )

    this.add.rectangle(
      GAME_WIDTH / 2,
      HORIZON_Y - 16,
      GAME_WIDTH,
      32,
      0x4e8d47,
    )

    this.mode7Renderer = new Mode7Renderer(
      this,
      TRACK_TEXTURE_KEY,
      GAME_WIDTH,
      GROUND_HEIGHT,
      0,
      HORIZON_Y,
    )

    this.trackSurfaceMap = new TrackSurfaceMap(this, TRACK_TEXTURE_KEY)

    const worldScale = Math.min(
      this.mode7Renderer.sourceWidth,
      this.mode7Renderer.sourceHeight,
    )

    this.playerKart = new PlayerKart(
      this.mode7Renderer.sourceWidth * 0.5,
      this.mode7Renderer.sourceHeight * 0.78,
      Math.PI / 2,
      worldScale,
    )

    this.currentSurface = this.trackSurfaceMap.sample(
      this.playerKart.x,
      this.playerKart.y,
    )

    this.syncCameraToKart()
    this.createKeyboardControls()
    this.createHud()

    this.racerSprite = new RacerSpriteView(
      this,
      RACER_TEXTURE_KEY,
      GAME_WIDTH / 2,
      GAME_HEIGHT - 42,
    )

    this.mode7Renderer.render(this.cameraState)
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

    this.currentSurface = this.trackSurfaceMap.sample(
      this.playerKart.x,
      this.playerKart.y,
    )

    this.playerKart.update(
      {
        accelerate: this.cursors.up.isDown || this.wasd.up.isDown,
        brake: this.cursors.down.isDown || this.wasd.down.isDown,
        steerLeft,
        steerRight,
      },
      deltaSeconds,
      SURFACE_HANDLING[this.currentSurface],
    )

    this.syncCameraToKart()

    let steerDirection = 0

    if (steerLeft) {
      steerDirection = -1
    } else if (steerRight) {
      steerDirection = 1
    }

    this.racerSprite?.update(steerDirection, deltaSeconds)
    this.updateHud()
    this.mode7Renderer.render(this.cameraState)
  }

  private createKeyboardControls() {
    const keyboard = this.input.keyboard

    if (!keyboard) {
      return
    }

    this.cursors = keyboard.createCursorKeys()
    this.wasd = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as {
      up: Phaser.Input.Keyboard.Key
      down: Phaser.Input.Keyboard.Key
      left: Phaser.Input.Keyboard.Key
      right: Phaser.Input.Keyboard.Key
    }
  }

  private createHud() {
    this.add
      .text(20, 18, 'RETRO KART // SURFACE TEST', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setDepth(30)

    this.add
      .text(20, 48, 'UP/W ACCELERATE   DOWN/S BRAKE + REVERSE', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setDepth(30)

    this.add
      .text(20, 68, 'LEFT/RIGHT OR A/D STEER', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setDepth(30)

    this.speedText = this.add
      .text(20, GAME_HEIGHT - 44, 'SPEED 000', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setDepth(30)

    this.surfaceText = this.add
      .text(GAME_WIDTH - 20, GAME_HEIGHT - 44, 'ROAD', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(1, 0)
      .setDepth(30)

    this.add
      .image(GAME_WIDTH - 18, 18, TRACK_TEXTURE_KEY)
      .setOrigin(1, 0)
      .setDisplaySize(150, 150)
      .setAlpha(0.9)
      .setDepth(30)
  }

  private updateHud() {
    if (!this.speedText || !this.surfaceText || !this.playerKart) {
      return
    }

    const speedPercent = Math.round(Math.abs(this.playerKart.speedRatio) * 100)
    const direction = this.playerKart.speed < -0.01 ? 'R' : ' '

    this.speedText.setText(
      `SPEED ${direction}${speedPercent.toString().padStart(3, '0')}`,
    )

    const surfaceLabel =
      this.currentSurface === 'road'
        ? 'ROAD'
        : this.currentSurface === 'offRoad'
          ? 'OFF-ROAD'
          : 'OUTSIDE'

    this.surfaceText.setText(surfaceLabel)
  }

  private syncCameraToKart() {
    if (!this.playerKart) {
      return
    }

    this.cameraState.x = this.playerKart.x
    this.cameraState.y = this.playerKart.y
    this.cameraState.angle = this.playerKart.angle
  }
}
