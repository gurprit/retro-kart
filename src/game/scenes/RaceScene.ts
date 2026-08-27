import Phaser from 'phaser'
import { PlayerKart } from '../entities/PlayerKart'
import {
  Mode7Renderer,
  type Mode7CameraState,
} from '../rendering/Mode7Renderer'

const GAME_WIDTH = 800
const GAME_HEIGHT = 600
const HORIZON_Y = 250
const GROUND_HEIGHT = GAME_HEIGHT - HORIZON_Y
const TRACK_TEXTURE_KEY = 'prototype-track'

export class RaceScene extends Phaser.Scene {
  private mode7Renderer?: Mode7Renderer
  private playerKart?: PlayerKart
  private speedText?: Phaser.GameObjects.Text
  private kartGraphic?: Phaser.GameObjects.Container

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

    this.syncCameraToKart()
    this.createKeyboardControls()
    this.createHud()
    this.createKartGraphic()

    this.mode7Renderer.render(this.cameraState)
  }

  update(_time: number, delta: number) {
    if (
      !this.mode7Renderer ||
      !this.playerKart ||
      !this.cursors ||
      !this.wasd
    ) {
      return
    }

    const deltaSeconds = Math.min(delta / 1000, 0.05)
    const steerLeft = this.cursors.left.isDown || this.wasd.left.isDown
    const steerRight = this.cursors.right.isDown || this.wasd.right.isDown

    this.playerKart.update(
      {
        accelerate: this.cursors.up.isDown || this.wasd.up.isDown,
        brake: this.cursors.down.isDown || this.wasd.down.isDown,
        steerLeft,
        steerRight,
      },
      deltaSeconds,
    )

    this.syncCameraToKart()
    this.updateKartGraphic(steerLeft, steerRight)
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
      .text(20, 18, 'RETRO KART // HANDLING TEST', {
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

    this.add
      .image(GAME_WIDTH - 18, 18, TRACK_TEXTURE_KEY)
      .setOrigin(1, 0)
      .setDisplaySize(150, 150)
      .setAlpha(0.9)
      .setDepth(30)
  }

  private createKartGraphic() {
    const shadow = this.add.ellipse(0, 15, 82, 22, 0x000000, 0.35)
    const rearAxle = this.add.rectangle(0, 2, 76, 18, 0x252525)
    const leftTyre = this.add.rectangle(-36, 8, 15, 30, 0x111111)
    const rightTyre = this.add.rectangle(36, 8, 15, 30, 0x111111)
    const body = this.add.rectangle(0, -8, 54, 42, 0xd83b35)
    const seat = this.add.rectangle(0, -18, 29, 20, 0x24558a)
    const bumper = this.add.rectangle(0, 15, 58, 7, 0xe8e8e8)

    this.kartGraphic = this.add
      .container(GAME_WIDTH / 2, GAME_HEIGHT - 78, [
        shadow,
        rearAxle,
        leftTyre,
        rightTyre,
        body,
        seat,
        bumper,
      ])
      .setDepth(20)
  }

  private updateKartGraphic(steerLeft: boolean, steerRight: boolean) {
    if (!this.kartGraphic || !this.playerKart) {
      return
    }

    let steeringLean = 0

    if (steerLeft) {
      steeringLean = -0.035
    } else if (steerRight) {
      steeringLean = 0.035
    }

    const speedRatio = Math.min(1, Math.abs(this.playerKart.speedRatio))
    this.kartGraphic.rotation = steeringLean * speedRatio
  }

  private updateHud() {
    if (!this.speedText || !this.playerKart) {
      return
    }

    const speedPercent = Math.round(Math.abs(this.playerKart.speedRatio) * 100)
    const direction = this.playerKart.speed < -0.01 ? 'R' : ' '

    this.speedText.setText(
      `SPEED ${direction}${speedPercent.toString().padStart(3, '0')}`,
    )
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
