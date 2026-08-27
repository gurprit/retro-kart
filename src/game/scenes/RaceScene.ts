import Phaser from 'phaser'

export class RaceScene extends Phaser.Scene {
  constructor() {
    super('RaceScene')
  }

  create() {
    this.cameras.main.setBackgroundColor('#111111')

    this.add
      .text(400, 250, 'RETRO KART', {
        fontFamily: 'monospace',
        fontSize: '42px',
        color: '#ffffff',
      })
      .setOrigin(0.5)

    this.add
      .text(400, 310, 'Phaser prototype running', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5)
  }
}
