import Phaser from 'phaser'
import {
  Mode7Renderer,
  type Mode7CameraState,
  type Mode7GroundSprite,
} from '../rendering/Mode7Renderer'

export type ItemType =
  | 'banana'
  | 'bomb'
  | 'coin'
  | 'egg'
  | 'fireball'
  | 'greenShell'
  | 'redShell'
  | 'mushroom'
  | 'star'

export type ItemRacerState = {
  id: string
  x: number
  y: number
  angle: number
  speedRatio: number
  invulnerable: boolean
}

export type ItemSystemHooks = {
  ownerId: string
  getRacers: () => readonly ItemRacerState[]
  spinOutRacer: (racerId: string, blastX: number, blastY: number, pushStrength: number, controlLockSeconds: number) => void
  boostRacer: (racerId: string, multiplier: number, durationSeconds: number) => void
  grantStar: (racerId: string, durationSeconds: number) => void
  addCoin: (racerId: string, amount: number) => void
  isBarrierAt: (x: number, y: number) => boolean
}

type ItemBox = { id: string; x: number; y: number; active: boolean }
type RouletteFrame = { name: string; x: number; y: number }
type WorldItemKind = 'banana' | 'bomb' | 'coin' | 'greenShell' | 'redShell' | 'fireball' | 'egg'
type WorldItem = { id: number; kind: WorldItemKind; ownerId: string; x: number; y: number; vx: number; vy: number; ttl: number; ownerGrace: number; fuse?: number; trackCoin?: boolean; frameKeys: string[]; animationFps: number; image: Phaser.GameObjects.Image }
type WorldFrameConfig = { textureKey: string; frameCount: number; fps?: number }

const PICKUP_RADIUS_RATIO = 0.035
const ITEM_BOX_RESPAWN_MS = 5000
const PANEL_FRAME_MS = 50
const PANEL_TEXTURE_KEY = 'item-panels-mode7'
const PANEL_SIZE = 32
const ACTIVE_PANEL_FRAMES = 24
const EMPTY_PANEL_FRAME = ACTIVE_PANEL_FRAMES
const PANEL_FRAME_COUNT = ACTIVE_PANEL_FRAMES + 1
const PANEL_WORLD_SCALE = 1.05
const ROULETTE_FRAME_WIDTH = 26
const ROULETTE_FRAME_HEIGHT = 18
const ROULETTE_START_X = 0
const ROULETTE_START_Y = 19
const ROULETTE_COLUMN_STRIDE = 27
const ROULETTE_ROW_STRIDE = 19
const ROULETTE_COLUMNS = 3
const ROULETTE_ROWS = 4
const ROULETTE_ICON_SCALE = 3
const ROULETTE_DURATION_MS = 1250
const ROULETTE_STEP_MS = 75
const ROULETTE_FRAME_PREFIX = 'roulette-item-'
const BATTLE_COURSE_ITEM_BOX_COUNT = 100
const BATTLE_COURSE_COIN_COUNT = 1000
const BATTLE_COURSE_EDGE_MARGIN = 0.075

const ITEM_LABELS: Record<ItemType, string> = { banana: 'BANANA', bomb: 'BOMB', coin: 'COIN', egg: 'LIGHTNING', fireball: 'FIREBALL', greenShell: 'GREEN SHELL', redShell: 'RED SHELL', mushroom: 'MUSHROOM', star: 'STAR' }
const ITEM_POOL: ItemType[] = ['banana','banana','greenShell','greenShell','redShell','mushroom','mushroom','coin','coin','fireball','egg','bomb','star']
const ROULETTE_FRAMES: RouletteFrame[] = Array.from({ length: ROULETTE_COLUMNS * ROULETTE_ROWS }, (_, index) => ({ name: `${ROULETTE_FRAME_PREFIX}${index}`, x: ROULETTE_START_X + (index % ROULETTE_COLUMNS) * ROULETTE_COLUMN_STRIDE, y: ROULETTE_START_Y + Math.floor(index / ROULETTE_COLUMNS) * ROULETTE_ROW_STRIDE }))
const ROULETTE_FRAME_BY_ITEM: Record<ItemType, number> = { star:0, banana:1, greenShell:2, redShell:3, coin:6, fireball:7, mushroom:8, bomb:8, egg:10 }
const ROULETTE_CYCLE_FRAMES = [0,1,2,3,4,5,6,7,8,10] as const
const WORLD_FRAME_CONFIG: Record<Exclude<WorldItemKind,'banana'>,WorldFrameConfig> = { bomb:{textureKey:'item-bomb',frameCount:1}, coin:{textureKey:'item-coin',frameCount:3,fps:10}, greenShell:{textureKey:'item-green-shell',frameCount:3,fps:12}, redShell:{textureKey:'item-red-shell',frameCount:1}, fireball:{textureKey:'item-fireball',frameCount:5,fps:15}, egg:{textureKey:'item-egg',frameCount:1} }
const WORLD_ITEM_SIZE=38, WORLD_ITEM_HIT_RADIUS_RATIO=.025, BANANA_DROP_DISTANCE_RATIO=.026, PROJECTILE_START_DISTANCE_RATIO=.055, SHELL_SPEED_RATIO=.62, FIREBALL_SPEED_RATIO=.68, BOMB_THROW_SPEED_RATIO=.24, BOMB_FUSE_SECONDS=1.05, BOMB_BLAST_RADIUS_RATIO=.145, BOMB_PUSH_STRENGTH_RATIO=.22, BOMB_CONTROL_LOCK_SECONDS=1.05, PROJECTILE_CONTROL_LOCK_SECONDS=.72, PROJECTILE_PUSH_RATIO=.105, TRACK_COIN_RESPAWN_MS=4500, STAR_DURATION_SECONDS=6, MUSHROOM_DURATION_SECONDS=.9, MUSHROOM_MULTIPLIER=1.55
const STAR_EVENT='retro-kart:star-activated'

export class ItemSystem {
  private readonly scene: Phaser.Scene; private readonly renderer: Mode7Renderer; private readonly worldScale:number; private readonly rouletteTextureKey:string; private readonly hooks:ItemSystemHooks; private readonly itemBoxes:ItemBox[]; private readonly pickupRadius:number; private readonly worldItemHitRadius:number; private readonly worldItems:WorldItem[]=[]; private readonly worldFrames=new Map<WorldItemKind,string[]>()
  private heldItem?:ItemType; private rouletteResult?:ItemType; private rouletteRunning=false; private rouletteFrameIndex=0; private panelFrame=0; private nextWorldItemId=1; private networkAuthority=false; private panelTimer?:Phaser.Time.TimerEvent; private rouletteTimer?:Phaser.Time.TimerEvent; private rouletteFinishTimer?:Phaser.Time.TimerEvent; private readonly rouletteSprite:Phaser.GameObjects.Image; private readonly heldText:Phaser.GameObjects.Text
  constructor(scene:Phaser.Scene,renderer:Mode7Renderer,worldScale:number,rouletteTextureKey:string,hooks:ItemSystemHooks){this.scene=scene;this.renderer=renderer;this.worldScale=worldScale;this.rouletteTextureKey=rouletteTextureKey;this.hooks=hooks;this.pickupRadius=worldScale*PICKUP_RADIUS_RATIO;this.worldItemHitRadius=worldScale*WORLD_ITEM_HIT_RADIUS_RATIO;this.createPanelTexture();this.registerRouletteFrames(rouletteTextureKey);this.registerWorldItemFrames();this.itemBoxes=this.createBattleCourseItemBoxes();this.rouletteSprite=scene.add.image(90,124,rouletteTextureKey,ROULETTE_FRAMES[0].name).setDepth(41).setOrigin(.5).setScale(ROULETTE_ICON_SCALE).setVisible(false);this.heldText=scene.add.text(90,158,'',{fontFamily:'monospace',fontSize:'13px',color:'#ffffff',stroke:'#000000',strokeThickness:3,align:'center'}).setOrigin(.5,0).setDepth(42);this.panelTimer=scene.time.addEvent({delay:PANEL_FRAME_MS,loop:true,callback:()=>{this.panelFrame=(this.panelFrame+1)%ACTIVE_PANEL_FRAMES;this.refreshGroundPanels()}});this.spawnTrackCoins();this.refreshGroundPanels()}
  update(deltaSeconds:number,camera:Mode7CameraState){this.checkItemBoxPickup();this.updateWorldItems(deltaSeconds,camera)}
  setNetworkAuthority(enabled:boolean){if(this.networkAuthority===enabled)return;this.networkAuthority=enabled;if(enabled){for(let i=this.worldItems.length-1;i>=0;i--)if(this.worldItems[i].trackCoin)this.removeWorldItem(i)}else if(!this.worldItems.some(i=>i.trackCoin))this.spawnTrackCoins()}
  useHeldItem(){if(!this.heldItem||this.rouletteRunning)return undefined;const item=this.heldItem;this.heldItem=undefined;this.updateHeldHud();this.activateItem(item);return item}
  get currentItem(){return this.heldItem}
  destroy(){this.panelTimer?.destroy();this.rouletteTimer?.destroy();this.rouletteFinishTimer?.destroy();this.renderer.setGroundSprites(PANEL_TEXTURE_KEY,[]);this.rouletteSprite.destroy();this.heldText.destroy();for(const item of this.worldItems)item.image.destroy();this.worldItems.length=0;if(this.scene.textures.exists(PANEL_TEXTURE_KEY))this.scene.textures.remove(PANEL_TEXTURE_KEY)}
  private createBattleCourseItemBoxes(){return this.generateBattleCoursePoints(BATTLE_COURSE_ITEM_BOX_COUNT,0x1bc100,0.035).map((p,index)=>({id:`bc1-${String(index+1).padStart(3,'0')}`,x:p.x,y:p.y,active:true}))}
  private generateBattleCoursePoints(count:number,seed:number,minSpacingRatio:number){let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};const points:{x:number;y:number}[]=[];const margin=BATTLE_COURSE_EDGE_MARGIN;const minSpacing=this.worldScale*minSpacingRatio;const minSpacingSq=minSpacing*minSpacing;const barrierClearance=Math.max(8,this.worldScale*.018);let attempts=0;const maxAttempts=count*500;while(points.length<count&&attempts<maxAttempts){attempts++;const xr=margin+random()*(1-margin*2),yr=margin+random()*(1-margin*2),x=this.renderer.sourceWidth*xr,y=this.renderer.sourceHeight*yr;if(this.hooks.isBarrierAt(x,y)||this.hooks.isBarrierAt(x+barrierClearance,y)||this.hooks.isBarrierAt(x-barrierClearance,y)||this.hooks.isBarrierAt(x,y+barrierClearance)||this.hooks.isBarrierAt(x,y-barrierClearance))continue;if(minSpacingSq>0&&points.some(p=>{const dx=p.x-x,dy=p.y-y;return dx*dx+dy*dy<minSpacingSq}))continue;points.push({x,y})}return points}
  private checkItemBoxPickup(){if(this.heldItem||this.rouletteRunning)return;const owner=this.hooks.getRacers().find(r=>r.id===this.hooks.ownerId);if(!owner)return;const rs=this.pickupRadius*this.pickupRadius;for(const b of this.itemBoxes){if(!b.active)continue;const dx=owner.x-b.x,dy=owner.y-b.y;if(dx*dx+dy*dy<=rs){b.active=false;this.refreshGroundPanels();this.startRoulette();this.scene.time.delayedCall(ITEM_BOX_RESPAWN_MS,()=>{b.active=true;this.refreshGroundPanels()});break}}}
  private startRoulette(){this.rouletteRunning=true;this.rouletteResult=ITEM_POOL[Math.floor(Math.random()*ITEM_POOL.length)];this.rouletteFrameIndex=0;this.rouletteSprite.setTexture(this.rouletteTextureKey,ROULETTE_FRAMES[0].name).setScale(ROULETTE_ICON_SCALE).setVisible(true);this.applyRouletteFrame(ROULETTE_CYCLE_FRAMES[0]);this.heldText.setText('ROULETTE');this.rouletteTimer?.destroy();this.rouletteTimer=this.scene.time.addEvent({delay:ROULETTE_STEP_MS,loop:true,callback:()=>{this.rouletteFrameIndex=(this.rouletteFrameIndex+1)%ROULETTE_CYCLE_FRAMES.length;this.applyRouletteFrame(ROULETTE_CYCLE_FRAMES[this.rouletteFrameIndex])}});this.rouletteFinishTimer?.destroy();this.rouletteFinishTimer=this.scene.time.delayedCall(ROULETTE_DURATION_MS,()=>{this.rouletteTimer?.destroy();this.rouletteTimer=undefined;this.rouletteRunning=false;this.heldItem=this.rouletteResult??'banana';this.rouletteResult=undefined;this.updateHeldHud()})}
  private activateItem(item:ItemType){const owner=this.hooks.getRacers().find(r=>r.id===this.hooks.ownerId);if(!owner)return;switch(item){case'banana':if(!this.networkAuthority)this.spawnBanana(owner);break;case'greenShell':if(!this.networkAuthority)this.spawnProjectile('greenShell',owner,SHELL_SPEED_RATIO);break;case'redShell':if(!this.networkAuthority)this.spawnProjectile('redShell',owner,SHELL_SPEED_RATIO*.93);break;case'fireball':if(!this.networkAuthority)this.spawnProjectile('fireball',owner,FIREBALL_SPEED_RATIO);break;case'egg':break;case'bomb':if(!this.networkAuthority)this.spawnBomb(owner);break;case'mushroom':this.hooks.boostRacer(owner.id,MUSHROOM_MULTIPLIER,MUSHROOM_DURATION_SECONDS);break;case'star':this.hooks.grantStar(owner.id,STAR_DURATION_SECONDS);this.scene.events.emit(STAR_EVENT,owner.id,STAR_DURATION_SECONDS);break;case'coin':this.hooks.addCoin(owner.id,2);this.createRouletteCoinVisual();break}}
  private spawnBanana(o:ItemRacerState){const d=this.worldScale*BANANA_DROP_DISTANCE_RATIO,fx=Math.sin(o.angle),fy=-Math.cos(o.angle);this.spawnWorldItem('banana',o.id,o.x+fx*d,o.y+fy*d,0,0,14,.9)}
  private spawnProjectile(k:'greenShell'|'redShell'|'fireball',o:ItemRacerState,sr:number){const d=this.worldScale*PROJECTILE_START_DISTANCE_RATIO,s=this.worldScale*sr,fx=Math.sin(o.angle),fy=-Math.cos(o.angle),ttl=k==='fireball'?4:7;this.spawnWorldItem(k,o.id,o.x+fx*d,o.y+fy*d,fx*s,fy*s,ttl,.45)}
  private spawnBomb(o:ItemRacerState){const d=this.worldScale*PROJECTILE_START_DISTANCE_RATIO,s=this.worldScale*BOMB_THROW_SPEED_RATIO,fx=Math.sin(o.angle),fy=-Math.cos(o.angle),item=this.spawnWorldItem('bomb',o.id,o.x+fx*d,o.y+fy*d,fx*s,fy*s,BOMB_FUSE_SECONDS+.1,.25);item.fuse=BOMB_FUSE_SECONDS}
  private spawnTrackCoins(){if(this.networkAuthority)return;for(const p of this.generateBattleCoursePoints(BATTLE_COURSE_COIN_COUNT,0xc01bc1,0.0065))this.spawnWorldItem('coin','track',p.x,p.y,0,0,Infinity,0,true)}
  private spawnWorldItem(kind:WorldItemKind,ownerId:string,x:number,y:number,vx:number,vy:number,ttl:number,ownerGrace:number,trackCoin=false){const frameKeys=this.worldFrames.get(kind)??[];if(!frameKeys.length)throw new Error(`Missing world item frames for ${kind}`);const image=this.scene.add.image(-1000,-1000,frameKeys[0]).setDepth(12).setOrigin(.5).setVisible(false);const config=kind==='banana'?undefined:WORLD_FRAME_CONFIG[kind];const item:WorldItem={id:this.nextWorldItemId++,kind,ownerId,x,y,vx,vy,ttl,ownerGrace,trackCoin,frameKeys,animationFps:config?.fps??0,image};this.worldItems.push(item);return item}
  private updateWorldItems(dt:number,camera:Mode7CameraState){for(let i=this.worldItems.length-1;i>=0;i--){const item=this.worldItems[i];item.ttl-=dt;item.ownerGrace=Math.max(0,item.ownerGrace-dt);if(item.kind==='bomb'){item.fuse=Math.max(0,(item.fuse??0)-dt);item.x+=item.vx*dt;item.y+=item.vy*dt;item.vx*=Math.pow(.06,dt);item.vy*=Math.pow(.06,dt);if((item.fuse??0)<=0){this.detonateBomb(item,camera);this.removeWorldItem(i);continue}}else if(item.kind!=='banana'&&item.kind!=='coin'&&item.kind!=='egg')this.updateProjectile(item,dt);if(item.ttl<=0){this.removeWorldItem(i);continue}if(this.checkWorldItemHits(item,camera)){this.removeWorldItem(i);continue}this.updateWorldItemVisual(item,camera)}}
  private updateProjectile(item:WorldItem,dt:number){if(item.kind==='redShell')this.homeRedShell(item,dt);const nx=item.x+item.vx*dt,ny=item.y+item.vy*dt;if(this.hooks.isBarrierAt(nx,ny)){if(item.kind==='greenShell'){const hx=this.hooks.isBarrierAt(nx,item.y),hy=this.hooks.isBarrierAt(item.x,ny);if(hx||(!hx&&!hy))item.vx*=-1;if(hy||(!hx&&!hy))item.vy*=-1;item.x+=item.vx*dt;item.y+=item.vy*dt}else item.ttl=0;return}item.x=nx;item.y=ny}
  private homeRedShell(item:WorldItem,dt:number){const targets=this.hooks.getRacers().filter(r=>r.id!==item.ownerId).sort((a,b)=>{const ax=a.x-item.x,ay=a.y-item.y,bx=b.x-item.x,by=b.y-item.y;return ax*ax+ay*ay-(bx*bx+by*by)}),t=targets[0];if(!t)return;const s=Math.hypot(item.vx,item.vy),dx=t.x-item.x,dy=t.y-item.y,l=Math.max(.001,Math.hypot(dx,dy)),f=Math.min(1,dt*3.8);item.vx=Phaser.Math.Linear(item.vx,dx/l*s,f);item.vy=Phaser.Math.Linear(item.vy,dy/l*s,f)}
  private checkWorldItemHits(item:WorldItem,camera:Mode7CameraState){const rs=this.worldItemHitRadius*this.worldItemHitRadius;for(const r of this.hooks.getRacers()){if(r.id===item.ownerId&&item.ownerGrace>0)continue;const dx=r.x-item.x,dy=r.y-item.y;if(dx*dx+dy*dy>rs)continue;if(item.kind==='coin'){this.hooks.addCoin(r.id,1);this.createCoinPickupVisual(item.x,item.y,camera);if(item.trackCoin&&!this.networkAuthority){const{x,y}=item;this.scene.time.delayedCall(TRACK_COIN_RESPAWN_MS,()=>this.spawnWorldItem('coin','track',x,y,0,0,Infinity,0,true))}return true}if(item.kind==='bomb'){this.detonateBomb(item,camera);return true}if(r.invulnerable)return true;this.hooks.spinOutRacer(r.id,item.x,item.y,this.worldScale*PROJECTILE_PUSH_RATIO,item.kind==='banana'?.95:PROJECTILE_CONTROL_LOCK_SECONDS);return true}return false}
  private detonateBomb(item:WorldItem,camera:Mode7CameraState){const radius=this.worldScale*BOMB_BLAST_RADIUS_RATIO,rs=radius*radius,push=this.worldScale*BOMB_PUSH_STRENGTH_RATIO;for(const r of this.hooks.getRacers()){const dx=r.x-item.x,dy=r.y-item.y;if(dx*dx+dy*dy>rs||r.invulnerable)continue;this.hooks.spinOutRacer(r.id,item.x,item.y,push,BOMB_CONTROL_LOCK_SECONDS)}this.createExplosionVisual(item.x,item.y,camera)}
  private createExplosionVisual(x:number,y:number,camera:Mode7CameraState){const p=this.renderer.projectWorldPoint(x,y,camera);if(!p)return;const br=Phaser.Math.Clamp(24*p.scale,18,42),ring=this.scene.add.circle(p.x,p.y,br,0xffffff,.08).setStrokeStyle(5,0xfff7cf,.95).setDepth(80);this.scene.tweens.add({targets:ring,scale:3.8,alpha:0,duration:520,ease:'Quad.easeOut',onComplete:()=>ring.destroy()});for(let i=0;i<26;i++){const a=Phaser.Math.FloatBetween(0,Math.PI*2),d=Phaser.Math.Between(42,105),s=this.scene.add.rectangle(p.x,p.y,Phaser.Math.Between(2,4),Phaser.Math.Between(7,13),i%3===0?0xffffff:0xffc35a,1).setRotation(a).setDepth(83);this.scene.tweens.add({targets:s,x:p.x+Math.cos(a)*d,y:p.y+Math.sin(a)*d*.68,alpha:0,scaleY:.2,duration:Phaser.Math.Between(260,460),ease:'Quad.easeOut',onComplete:()=>s.destroy()})}}
  private createRouletteCoinVisual(){const frames=this.worldFrames.get('coin')??[];if(!frames.length)return;const x=this.scene.scale.width/2,y=this.scene.scale.height-105,coin=this.scene.add.image(x,y,frames[0]).setDepth(90).setDisplaySize(38,38).setOrigin(.5);let fi=0;const anim=this.scene.time.addEvent({delay:80,loop:true,callback:()=>{fi=(fi+1)%frames.length;coin.setTexture(frames[fi])}});this.scene.tweens.add({targets:coin,y:y-88,duration:270,ease:'Quad.easeOut',yoyo:true,hold:70,onComplete:()=>{anim.destroy();coin.destroy()}})}
  private createCoinPickupVisual(x:number,y:number,camera:Mode7CameraState){const p=this.renderer.projectWorldPoint(x,y,camera);if(!p)return;for(let i=0;i<8;i++){const a=i/8*Math.PI*2,s=this.scene.add.circle(p.x,p.y,3,i%2===0?0xffffff:0xffe34d,1).setDepth(84);this.scene.tweens.add({targets:s,x:p.x+Math.cos(a)*24,y:p.y+Math.sin(a)*18-8,alpha:0,scale:.2,duration:300,onComplete:()=>s.destroy()})}}
  private updateWorldItemVisual(item:WorldItem,camera:Mode7CameraState){const p=this.renderer.projectWorldPoint(item.x,item.y,camera);if(!p){item.image.setVisible(false);return}if(item.frameKeys.length>1&&item.animationFps>0)item.image.setTexture(item.frameKeys[Math.floor(this.scene.time.now/1000*item.animationFps)%item.frameKeys.length]);const scale=Phaser.Math.Clamp(p.scale,.42,1.75),bob=item.kind==='banana'?0:Math.sin(this.scene.time.now*.01+item.id)*(item.kind==='coin'?2:3),mult=item.kind==='banana'?1.45:item.kind==='coin'?.92:1;item.image.setVisible(true).setPosition(p.x,p.y-7*scale+bob).setDisplaySize(WORLD_ITEM_SIZE*scale*mult,WORLD_ITEM_SIZE*scale*mult).setDepth(12+p.screenY*.01).setRotation(item.kind==='fireball'?this.scene.time.now*.004:0)}
  private removeWorldItem(i:number){const[item]=this.worldItems.splice(i,1);item?.image.destroy()}
  private registerWorldItemFrames(){const banana=this.createStandaloneFrame(this.rouletteTextureKey,ROULETTE_FRAMES[ROULETTE_FRAME_BY_ITEM.banana].name,'retro-kart-banana-world-frame');if(banana)this.worldFrames.set('banana',[banana]);for(const[kind,config]of Object.entries(WORLD_FRAME_CONFIG) as [Exclude<WorldItemKind,'banana'>,WorldFrameConfig][]){const texture=this.scene.textures.get(config.textureKey),source=texture.getSourceImage() as {width:number;height:number},hfw=source.width/config.frameCount,ha=hfw/Math.max(1,source.height),vfh=source.height/config.frameCount,va=source.width/Math.max(1,vfh),horizontal=Math.abs(ha-1)<=Math.abs(va-1),fw=horizontal?Math.floor(source.width/config.frameCount):source.width,fh=horizontal?source.height:Math.floor(source.height/config.frameCount),keys:string[]=[];for(let i=0;i<config.frameCount;i++){const frameName=`world-${kind}-${i}`;if(!texture.has(frameName))texture.add(frameName,0,horizontal?i*fw:0,horizontal?0:i*fh,fw,fh);const key=`retro-kart-${kind}-frame-${i}`,standalone=this.createStandaloneFrame(config.textureKey,frameName,key,kind==='greenShell');if(standalone)keys.push(standalone)}this.worldFrames.set(kind,keys)}}
  private createStandaloneFrame(textureKey:string,frameName:string,outputKey:string,chromaKeyBackground=false){if(this.scene.textures.exists(outputKey))return outputKey;const texture=this.scene.textures.get(textureKey),frame=texture.get(frameName),canvas=this.scene.textures.createCanvas(outputKey,frame.width,frame.height);if(!canvas)return undefined;const ctx=canvas.context,source=texture.getSourceImage() as CanvasImageSource;ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,frame.width,frame.height);ctx.drawImage(source,frame.cutX,frame.cutY,frame.cutWidth,frame.cutHeight,0,0,frame.width,frame.height);if(chromaKeyBackground){const imageData=ctx.getImageData(0,0,frame.width,frame.height),data=imageData.data;const cornerSamples=[[0,0],[frame.width-1,0],[0,frame.height-1],[frame.width-1,frame.height-1]];let br=0,bg=0,bb=0;for(const[x,y]of cornerSamples){const offset=(y*frame.width+x)*4;br+=data[offset];bg+=data[offset+1];bb+=data[offset+2]}br/=cornerSamples.length;bg/=cornerSamples.length;bb/=cornerSamples.length;const toleranceSq=78*78;for(let i=0;i<data.length;i+=4){const dr=data[i]-br,dg=data[i+1]-bg,db=data[i+2]-bb;if(dr*dr+dg*dg+db*db<=toleranceSq)data[i+3]=0}ctx.putImageData(imageData,0,0)}canvas.refresh();return outputKey}
  private registerRouletteFrames(key:string){const t=this.scene.textures.get(key);for(const f of ROULETTE_FRAMES)if(!t.has(f.name))t.add(f.name,0,f.x,f.y,ROULETTE_FRAME_WIDTH,ROULETTE_FRAME_HEIGHT)}
  private applyRouletteFrame(i:number){const f=ROULETTE_FRAMES[i];if(f)this.rouletteSprite.setTexture(this.rouletteTextureKey,f.name)}
  private updateHeldHud(){if(!this.heldItem){this.rouletteSprite.setVisible(false);this.heldText.setText('');return}this.rouletteSprite.setVisible(true).setTexture(this.rouletteTextureKey,ROULETTE_FRAMES[ROULETTE_FRAME_BY_ITEM[this.heldItem]].name).setScale(ROULETTE_ICON_SCALE);this.heldText.setText(`${ITEM_LABELS[this.heldItem]}  [SPACE]`)}
  private createPanelTexture(){if(this.scene.textures.exists(PANEL_TEXTURE_KEY))return;const t=this.scene.textures.createCanvas(PANEL_TEXTURE_KEY,PANEL_SIZE*PANEL_FRAME_COUNT,PANEL_SIZE);if(!t)return;const c=t.context;c.imageSmoothingEnabled=false;for(let f=0;f<ACTIVE_PANEL_FRAMES;f++){const x=f*PANEL_SIZE;this.drawPanelBase(c,x,true);const gx=Math.floor(f/ACTIVE_PANEL_FRAMES*PANEL_SIZE);c.save();c.beginPath();c.rect(x,0,PANEL_SIZE,PANEL_SIZE);c.clip();this.drawQuestionMark(c,x+gx,5);this.drawQuestionMark(c,x+gx-PANEL_SIZE,5);c.restore()}this.drawPanelBase(c,EMPTY_PANEL_FRAME*PANEL_SIZE,false);this.drawSadFace(c,EMPTY_PANEL_FRAME*PANEL_SIZE,0);t.refresh()}
  private drawPanelBase(c:CanvasRenderingContext2D,x:number,a:boolean){c.fillStyle=a?'#ffc000':'#d90000';c.fillRect(x,0,PANEL_SIZE,PANEL_SIZE);c.fillStyle=a?'#ffffff':'#ff9300';c.fillRect(x,0,PANEL_SIZE-2,2);c.fillRect(x,0,2,PANEL_SIZE-2);c.fillStyle=a?'#9d1400':'#690000';c.fillRect(x,PANEL_SIZE-2,PANEL_SIZE,2);c.fillRect(x+PANEL_SIZE-2,0,2,PANEL_SIZE)}
  private drawQuestionMark(c:CanvasRenderingContext2D,x:number,y:number){c.fillStyle='#050505';const b=3,p=[[1,0],[2,0],[3,0],[4,0],[0,1],[4,1],[3,2],[4,2],[2,3],[3,3],[2,4],[2,6]] as const;for(const[px,py]of p)c.fillRect(x+px*b,y+py*b,b,b)}
  private drawSadFace(c:CanvasRenderingContext2D,x:number,y:number){c.fillStyle='#4b0000';c.fillRect(x+8,y+9,4,5);c.fillRect(x+20,y+9,4,5);c.fillRect(x+10,y+21,3,3);c.fillRect(x+13,y+18,6,3);c.fillRect(x+19,y+21,3,3)}
  private refreshGroundPanels(){const sprites:Mode7GroundSprite[]=this.itemBoxes.map(b=>({x:b.x,y:b.y,frameX:(b.active?this.panelFrame:EMPTY_PANEL_FRAME)*PANEL_SIZE,frameY:0,frameWidth:PANEL_SIZE,frameHeight:PANEL_SIZE,worldScale:PANEL_WORLD_SCALE}));this.renderer.setGroundSprites(PANEL_TEXTURE_KEY,sprites)}
}
