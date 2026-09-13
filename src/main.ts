import './style.css';

type Gem = 0 | 1 | 2 | 3 | 4 | 5;
type Gap = 'gap';
type Cell = Gem | Gap | null;
type StackSlot = Gem | Gap;
type Stack = [StackSlot, StackSlot, StackSlot];

type Active = {
  col: number;
  row: number;
  gems: Stack;
};

const COLS = 6;
const ROWS = 13;
const COLORS = ['#e84c5b','#44a8ff','#ffd64b','#55d28d','#ba6cff','#ff8d3b'];
const BASE_DROP_MS = 720;
const MIN_DROP_MS = 150;
const GAP_ODDS_DENOMINATOR = COLORS.length + 1;

const $ = <T extends HTMLElement>(s:string) => document.querySelector<T>(s)!;
const canvas = $('#game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const ui = {
  score: $('#score'), level: $('#level'), chain: $('#chain'), next: $('#next'),
  overlay: $('#overlay'), overlayKicker: $('#overlay-kicker'), overlayTitle: $('#overlay-title'), overlayCopy: $('#overlay-copy'),
  restart: $('#restart') as HTMLButtonElement, pause: $('#pause') as HTMLButtonElement,
  left: $('#left') as HTMLButtonElement, right: $('#right') as HTMLButtonElement,
  cycle: $('#cycle') as HTMLButtonElement, drop: $('#drop') as HTMLButtonElement,
};

class Game {
  board: Cell[][] = [];
  active!: Active;
  next: Stack = this.randomStack();
  score = 0;
  level = 1;
  chain = 0;
  cleared = 0;
  over = false;
  paused = false;
  busy = false;
  last = 0;
  fallAcc = 0;
  softDrop = false;
  pointerStart?: {x:number;y:number;t:number};
  blinkingMatches?: Set<string>;
  blinkVisible = true;

  constructor(){
    this.bind();
    this.reset();
    requestAnimationFrame(t=>this.loop(t));
  }

  reset(){
    this.board = Array.from({length:ROWS},()=>Array<Cell>(COLS).fill(null));
    this.score = 0; this.level = 1; this.chain = 0; this.cleared = 0; this.over = false; this.paused = false; this.busy = false;
    this.fallAcc = 0; this.softDrop = false; this.blinkingMatches = undefined; this.blinkVisible = true;
    this.next = this.randomStack();
    this.spawn();
    ui.overlay.hidden = true;
    ui.pause.textContent = 'Ⅱ';
    this.updateUi();
  }

  randomGem():Gem { return Math.floor(Math.random()*COLORS.length) as Gem; }

  randomSlot():StackSlot {
    const roll=Math.floor(Math.random()*GAP_ODDS_DENOMINATOR);
    return roll===COLORS.length?'gap':roll as Gem;
  }

  randomStack():Stack {
    let stack:[StackSlot,StackSlot,StackSlot];
    do { stack=[this.randomSlot(),this.randomSlot(),this.randomSlot()]; }
    while(stack.every(slot=>slot==='gap'));
    return stack;
  }

  spawn(){
    this.active = {col:Math.floor(COLS/2), row:-2, gems:this.next};
    this.next = this.randomStack();
    this.fallAcc = 0;
    if(!this.canOccupy(this.active.col,this.active.row,this.active.gems)) this.gameOver();
    this.renderNext();
  }

  canOccupy(col:number,row:number,gems:Stack=this.active.gems){
    if(col<0||col>=COLS) return false;
    for(let i=0;i<3;i++){
      if(gems[i]==='gap') continue;
      const r=row+i;
      if(r>=ROWS) return false;
      if(r>=0 && this.board[r][col]!==null) return false;
    }
    return true;
  }

  move(dx:number){
    if(this.over||this.paused||this.busy) return;
    const next=this.active.col+dx;
    if(this.canOccupy(next,this.active.row)){this.active.col=next;this.draw();}
  }

  cycle(){
    if(this.over||this.paused||this.busy) return;
    const [a,b,c]=this.active.gems;
    this.active.gems=[c,a,b];
    this.draw();
  }

  step(){
    if(this.over||this.paused||this.busy) return;
    if(this.canOccupy(this.active.col,this.active.row+1)){
      this.active.row++;
    }else{
      void this.lock();
    }
    this.draw();
  }

  hardDrop(){
    if(this.over||this.paused||this.busy) return;
    let cells=0;
    while(this.canOccupy(this.active.col,this.active.row+1)){this.active.row++;cells++;}
    this.score += cells;
    void this.lock();
  }

  async lock(){
    if(this.busy||this.over) return;
    this.busy=true;
    const {col,row,gems}=this.active;
    for(let i=0;i<3;i++){
      const slot=gems[i];
      if(slot==='gap') {
        if(i===1){
          const r=row+i;
          if(r>=0&&r<ROWS) this.board[r][col]='gap';
        }
        continue;
      }
      const r=row+i;
      if(r<0){this.gameOver();this.busy=false;return;}
      this.board[r][col]=slot;
    }
    this.chain=0;
    await this.resolveBoard();
    if(!this.over) this.spawn();
    this.busy=false;
    this.updateUi();
    this.draw();
  }

  async resolveBoard(){
    while(true){
      const matches=this.findMatches();
      if(matches.size===0) break;
      this.chain++;
      const count=matches.size;
      const chainMult=Math.max(1,this.chain);
      this.score += count*10*chainMult*this.level;
      this.cleared += count;
      this.level = 1 + Math.floor(this.cleared/35);
      this.updateUi();
      await this.blink(matches);
      for(const key of matches){
        const [r,c]=key.split(',').map(Number);
        this.board[r][c]=null;
      }
      this.collapse();
      this.draw();
      await this.wait(140);
    }
  }

  async blink(matches:Set<string>){
    this.blinkingMatches=matches;
    for(let i=0;i<6;i++){
      this.blinkVisible=i%2===0;
      this.draw();
      await this.wait(95);
    }
    this.blinkingMatches=undefined;
    this.blinkVisible=true;
    this.draw();
  }

  findMatches(){
    const out=new Set<string>();
    const dirs=[[1,0],[0,1],[1,1],[1,-1]] as const;
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const gem=this.board[r][c];
      if(gem===null||gem==='gap') continue;
      for(const [dr,dc] of dirs){
        const run:[[number,number],[number,number],[number,number]]=[[r,c],[r+dr,c+dc],[r+dr*2,c+dc*2]];
        if(run.every(([rr,cc])=>rr>=0&&rr<ROWS&&cc>=0&&cc<COLS&&this.board[rr][cc]===gem)){
          for(const [rr,cc] of run) out.add(`${rr},${cc}`);
          let rr=r+dr*3,cc=c+dc*3;
          while(rr>=0&&rr<ROWS&&cc>=0&&cc<COLS&&this.board[rr][cc]===gem){out.add(`${rr},${cc}`);rr+=dr;cc+=dc;}
        }
      }
    }
    return out;
  }

  collapse(){
    for(let c=0;c<COLS;c++){
      const cells:(Gem|Gap)[]=[];
      for(let r=ROWS-1;r>=0;r--){
        const cell=this.board[r][c];
        if(cell!==null) cells.push(cell);
      }
      for(let r=ROWS-1,i=0;r>=0;r--,i++){
        this.board[r][c]=i<cells.length?cells[i]:null;
      }
    }
  }

  dropMs(){return Math.max(MIN_DROP_MS,BASE_DROP_MS-(this.level-1)*55);}

  loop(t:number){
    const dt=Math.min(40,t-this.last||0); this.last=t;
    if(!this.over&&!this.paused&&!this.busy){
      this.fallAcc+=dt;
      const interval=this.softDrop?45:this.dropMs();
      if(this.fallAcc>=interval){this.fallAcc=0;this.step();}
    }
    this.draw();
    requestAnimationFrame(tt=>this.loop(tt));
  }

  draw(){
    const rect=canvas.getBoundingClientRect();
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const W=rect.width,H=rect.height,cell=Math.min(W/COLS,H/ROWS),ox=(W-cell*COLS)/2,oy=(H-cell*ROWS)/2;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#030609';ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(255,255,255,.045)';ctx.lineWidth=1;
    for(let r=0;r<=ROWS;r++){ctx.beginPath();ctx.moveTo(ox,oy+r*cell);ctx.lineTo(ox+COLS*cell,oy+r*cell);ctx.stroke();}
    for(let c=0;c<=COLS;c++){ctx.beginPath();ctx.moveTo(ox+c*cell,oy);ctx.lineTo(ox+c*cell,oy+ROWS*cell);ctx.stroke();}
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const g=this.board[r][c];
      if(g===null||g==='gap') continue;
      const key=`${r},${c}`;
      const blinking=this.blinkingMatches?.has(key)??false;
      if(blinking&&!this.blinkVisible) continue;
      this.drawGem(c,r,g,cell,ox,oy,blinking);
    }
    if(!this.over){
      for(let i=0;i<3;i++){
        const r=this.active.row+i;
        const slot=this.active.gems[i];
        if(r>=0&&slot!=='gap') this.drawGem(this.active.col,r,slot,cell,ox,oy,false,true);
      }
    }
  }

  drawGem(c:number,r:number,g:Gem,cell:number,ox:number,oy:number,flashing=false,active=false){
    const pad=Math.max(2.5,cell*.08),x=ox+c*cell+pad,y=oy+r*cell+pad,s=cell-pad*2;
    ctx.save();
    if(flashing){ctx.shadowBlur=24;ctx.shadowColor='#fff';}
    else if(active){ctx.shadowBlur=10;ctx.shadowColor=COLORS[g];}
    ctx.fillStyle=COLORS[g];
    this.roundRect(x,y,s,s,Math.max(5,s*.17));ctx.fill();
    const grad=ctx.createLinearGradient(x,y,x,y+s);grad.addColorStop(0,'rgba(255,255,255,.42)');grad.addColorStop(.36,'rgba(255,255,255,.04)');grad.addColorStop(1,'rgba(0,0,0,.22)');ctx.fillStyle=grad;this.roundRect(x,y,s,s,Math.max(5,s*.17));ctx.fill();
    ctx.strokeStyle=flashing?'rgba(255,255,255,.92)':'rgba(255,255,255,.22)';ctx.lineWidth=flashing?2:1;this.roundRect(x+.5,y+.5,s-1,s-1,Math.max(5,s*.17));ctx.stroke();
    ctx.restore();
  }

  roundRect(x:number,y:number,w:number,h:number,r:number){
    const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
  }

  renderNext(){
    ui.next.innerHTML='';
    for(const slot of this.next){
      const el=document.createElement('div');
      el.className=slot==='gap'?'gem-preview gap-preview':'gem-preview';
      if(slot!=='gap') el.style.background=COLORS[slot];
      ui.next.appendChild(el);
    }
  }

  updateUi(){ui.score.textContent=this.score.toLocaleString();ui.level.textContent=String(this.level);ui.chain.textContent=this.chain>1?`×${this.chain}`:'—';}

  togglePause(){if(this.over||this.busy)return;this.paused=!this.paused;this.fallAcc=0;ui.pause.textContent=this.paused?'▶':'Ⅱ';ui.overlay.hidden=!this.paused;if(this.paused){ui.overlayKicker.textContent='PAUSED';ui.overlayTitle.textContent='Swifter';ui.overlayCopy.textContent='Tap play to continue.';ui.restart.textContent='Resume';}else{ui.restart.textContent='Play again';}}

  gameOver(){this.over=true;ui.overlay.hidden=false;ui.overlayKicker.textContent='GAME OVER';ui.overlayTitle.textContent='Nice run.';ui.overlayCopy.textContent=`Score ${this.score.toLocaleString()} · Level ${this.level}`;ui.restart.textContent='Play again';}

  wait(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));}

  bind(){
    ui.left.addEventListener('click',()=>this.move(-1));ui.right.addEventListener('click',()=>this.move(1));ui.cycle.addEventListener('click',()=>this.cycle());ui.drop.addEventListener('click',()=>this.hardDrop());ui.restart.addEventListener('click',()=>{if(this.paused)this.togglePause();else this.reset();});ui.pause.addEventListener('click',()=>this.togglePause());
    window.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowDown','ArrowUp',' ','KeyX','KeyZ'].includes(e.code))e.preventDefault();if(e.repeat&&e.code!=='ArrowDown')return;switch(e.code){case'ArrowLeft':this.move(-1);break;case'ArrowRight':this.move(1);break;case'ArrowUp':case'KeyX':case'KeyZ':this.cycle();break;case'ArrowDown':this.softDrop=true;break;case'Space':this.hardDrop();break;case'KeyP':this.togglePause();break;}});
    window.addEventListener('keyup',e=>{if(e.code==='ArrowDown')this.softDrop=false;});
    canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);this.pointerStart={x:e.clientX,y:e.clientY,t:performance.now()};});
    canvas.addEventListener('pointerup',e=>{if(!this.pointerStart)return;const dx=e.clientX-this.pointerStart.x,dy=e.clientY-this.pointerStart.y,dist=Math.hypot(dx,dy);if(dist<18){this.cycle();}else if(Math.abs(dx)>Math.abs(dy)){this.move(dx>0?1:-1);}else if(dy>20){this.hardDrop();}this.pointerStart=undefined;});
    canvas.addEventListener('pointercancel',()=>{this.pointerStart=undefined;});
    window.addEventListener('resize',()=>this.draw());
  }
}

new Game();
