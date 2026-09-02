# 🏎️ Retro Kart

A browser-based multiplayer kart racer inspired by the colourful, chaotic **16-bit kart games of the SNES era**. Retro Kart combines a Mode 7-style pseudo-3D track renderer with real-time multiplayer, computer-controlled racers, drifting, collisions, coins and a gloriously unruly collection of power-ups. 🍌🐢💥

> 🚧 **Work in progress:** Retro Kart is an experimental game currently under active development.

## 🎮 Play

### 🌐 Live build

**https://retro-kart.mirrorsspotify.workers.dev/**

The game runs directly in the browser and supports keyboard and touch controls.

## ✨ Current features

- 🏁 **Mode 7-inspired racing** with a SNES-style pseudo-3D track
- 🌍 **Real-time browser multiplayer** over native WebSockets
- ☁️ **Cloudflare Workers + Durable Objects** multiplayer backend
- 🤖 **Server-controlled CPU racers** using the same kart physics as players
- 🎯 CPU road sensing, steering, recovery and powersliding
- 💥 **Server-authoritative weapons and item simulation**
- 🍌 Bananas
- 🐢 Green and red shells
- 💣 Bombs
- 🍄 Mushroom boosts
- ⭐ Stars
- ⚡ Lightning
- 🪙 Coins and coin pickups
- 🎰 Animated item roulette
- 🧱 Track collision and barrier detection
- 🏎️ Different racer profiles and handling characteristics
- 📱 Portrait and landscape touch-control layouts
- 🎮 Keyboard controls on desktop
- 🌈 Star effects, particles, explosions and animated item sprites

## ☁️ Multiplayer architecture

Retro Kart originally used a traditional Node.js/Colyseus server. The multiplayer simulation has since moved to **Cloudflare Durable Objects**, allowing each race room to have its own authoritative shared state without needing a permanently running game server.

```text
Players
   │
   │ Native WebSockets
   ▼
Cloudflare Worker
   │
   ▼
Durable Object: Race Room
   ├── connected players
   ├── CPU racers
   ├── kart snapshots
   ├── item simulation
   ├── coins
   ├── collision data
   └── shared race state
```

The simulation runs while racers are connected and can become idle when a room is empty, keeping the architecture lightweight and inexpensive to operate. ☁️

## 🧠 CPU racers

Computer racers aren't simply sprites following a fixed animation. They use the game's kart physics and inspect the track around themselves to choose steering directions.

CPU behaviour currently includes:

- road and barrier sensing
- variable skill and pace
- lane variation
- collision recovery
- powersliding
- coin collection
- item collection and tactical item use
- attacking both human and computer racers
- star, lightning, shell, banana, bomb and mushroom interactions

The long-term goal is to support **large, wonderfully chaotic fields of racers** while keeping the simulation efficient enough to run inside a Cloudflare Durable Object. 🤖🏎️🏎️🏎️

## 🛠️ Tech stack

| Layer | Technology |
| --- | --- |
| 🎨 Game client | Phaser + TypeScript |
| ⚡ Build tooling | Vite |
| 🛣️ Rendering | Custom Mode 7-inspired renderer |
| 🌐 Networking | Native WebSockets |
| ☁️ Multiplayer | Cloudflare Workers + Durable Objects |
| 🤖 Simulation | Shared TypeScript kart / CPU / item simulation |

## 🚀 Local development

Clone the repository and install dependencies:

```bash
git clone https://github.com/gurprit/retro-kart.git
cd retro-kart
npm install
```

Start the game:

```bash
npm run dev
```

Then open the local Vite URL in your browser.

The browser client connects to the deployed Cloudflare multiplayer service, so a separate local Node multiplayer server is no longer required for normal development.

## 🧪 Build

```bash
npm run build
```

To validate the Cloudflare Worker without deploying it:

```bash
npm run cloudflare:check
```

To deploy the multiplayer Worker:

```bash
npm run cloudflare:deploy
```

## 🗺️ Roadmap

Some of the next areas being explored:

- 📦 fully shared/server-authoritative item boxes
- 🤖 larger CPU fields and performance testing
- 🏁 laps, checkpoints and race positions
- 🚦 proper race countdown/start sequence
- 🏆 finish order and results
- 🔄 improved prediction and reconciliation
- 👥 multiplayer room/lobby flow
- 🗺️ additional tracks
- 🎨 original production artwork and characters

## ⚠️ Prototype assets

Some current development assets originate from or are based on **Super Mario Kart** material and are being used for private/prototyping purposes while the game mechanics and rendering technology are developed.

These assets are **not intended to be the final production artwork**. The plan is to replace them with original assets before treating Retro Kart as a public release.

## 💡 Why Retro Kart?

The experiment is essentially:

> **What happens if an old-school Mode 7 kart racer gets dropped into a modern browser, connected to WebSockets, and then filled with far too many racers?** 🏎️💨

Apparently the answer involves a lot of shells.
