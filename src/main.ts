import './style.css';

type Gem = 0 | 1 | 2 | 3 | 4 | 5;
type Cell = Gem | null;
type Stack = [Gem, Gem, Gem];

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
  last = 0;
  fallAcc = 0;
  softDrop = false;
  pointerStart?: {x:number;y:number;t:number};

  constructor(){
    this.bind();
    this.reset();
    requestAnimationFrame(t=>this.loop(t));
  }

  reset(){
    this.board = Array.from({length:ROWS},()=>Array<Cell>(COLS).fill(null));
    this.score = 0; this.level = 1; this.chain = 0; this.cleared = 0; this.over = false; this.paused = false;
    this.next = this.randomStack();
    this.spawn();
    ui.overlay.hidden = true;
    ui.pause.textContent = 'Ⅱ';
    this.updateUi();
  }

  randomGem():Gem { return Math.floor(Math.random()*COLORS.length) as Gem; }
  randomStack():Stack { return [this.randomGem(),this.randomGem(),this.randomGem()]; }

  spawn(){
    this.active = {col:Math.floor(COLS/2), row:-2, gems:this.next};
    this.next = this.randomStack();
    if(!this.canOccupy(this.active.col,this.active.row)) this.gameOver();
    this.renderNext();
  }

  canOccupy(col:number,row:number){
    if(col<0||col>=COLS) return false;
    for(let i=0;i<3;i++){
      const r=row+i;
      if(r>=ROWS) return false;
      if(r>=0 && this.board[r][col]!==null) return false;
    }
    return true;
  }

  move(dx:number){
    if(this.over||this.paused) return;
    const next=this.active.col+dx;
    if(this.canOccupy(next,this.active.row)){this.active.col=next;this.draw();}
  }

  cycle(){
    if(this.over||this.paused) return;
    const [a,b,c]=this.active.gems;
    this.active.gems=[c,a,b];
    this.draw();
  }

  step(){
    if(this.over||this.paused) return;
    if(this.canOccupy(this.active.col,this.active.row+1)){
      this.active.row++;
    }else{
      void this.lock();
    }
    this.draw();
  }

  hardDrop(){
    if(this.over||this.paused) return;
    let cells=0;
    while(this.canOccupy(this.active.col,this.active.row+1)){this.active.row++;cells++;}
    this.score += cells;
    void this.lock();
  }

  async lock(){
    const {col,row,gems}=this.active;
    for(let i=0;i<3;i++){
      const r=row+i;
      if(r<0){this.gameOver();return;}
      this.board[r][col]=gems[i];
    }
    this.chain=0;
    await this.resolveBoard();
    if(!this.over) this.spawn();
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
      this.flash(matches);
      await this.wait(120);
      for(const key of matches){
        const [r,c]=key.split(',').map(Number);
        this.board[r][c]=null;
      }
      this.collapse();
      this.draw();
      await this.wait(110);
    }
  }

  findMatches(){
    const out=new Set<string>();
    const dirs=[[1,0],[0,1],[1,1],[1,-1]] as const;
    for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
      const gem=this.board[r][c]; if(gem===null) continue;
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
      const gems:Gem[]=[];
      for(let r=ROWS-1;r>=0;r--) if(this.board[r][c]!==null) gems.push(this.board[r][c] as Gem);
      for(let r=ROWS-1,i=0;r>=0;r--,i++) this.board[r][c]=i<gems.length?gems[i]:null;
    }
  }

  flash(matches:Set<string>){
    this.draw(matches);
  }

  dropMs(){return Math.max(MIN_DROP_MS,BASE_DROP_MS-(this.level-1)*55);}

  loop(t:number){
    const dt=Math.min(40,t-this.last||0); this.last=t;
    if(!this.over&&!this.paused){
      this.fallAcc+=dt;
      const interval=this.softDrop?45:this.dropMs();
      if(this.fallAcc>=interval){this.fallAcc=0;this.step();}
    }
    this.draw();
    requestAnimationFrame(tt=>this.loop(tt));
  }

  draw(flash?:Set<string>){
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
      const g=this.board[r][c];if(g!==null)this.drawGem(c,r,g,cell,ox,oy,flash?.has(`${r},${c}`)??false);
    }
    if(!this.over){for(let i=0;i<3;i++){const r=this.active.row+i;if(r>=0)this.drawGem(this.active.col,r,this.active.gems[i],cell,ox,oy,false,true);}}
  }

  drawGem(c:number,r:number,g:Gem,cell:number,ox:number,oy:number,flashing=false,active=false){
    const pad=Math.max(2.5,cell*.08),x=ox+c*cell+pad,y=oy+r*cell+pad,s=cell-pad*2;
    ctx.save();
    if(flashing){ctx.globalAlpha=.28;ctx.shadowBlur=22;ctx.shadowColor='#fff';}
    else if(active){ctx.shadowBlur=10;ctx.shadowColor=COLORS[g];}
    ctx.fillStyle=COLORS[g];
    this.roundRect(x,y,s,s,Math.max(5,s*.17));ctx.fill();
    const grad=ctx.createLinearGradient(x,y,x,y+s);grad.addColorStop(0,'rgba(255,255,255,.42)');grad.addColorStop(.36,'rgba(255,255,255,.04)');grad.addColorStop(1,'rgba(0,0,0,.22)');ctx.fillStyle=grad;this.roundRect(x,y,s,s,Math.max(5,s*.17));ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,.22)';ctx.lineWidth=1;this.roundRect(x+.5,y+.5,s-1,s-1,Math.max(5,s*.17));ctx.stroke();
    ctx.restore();
  }

  roundRect(x:number,y:number,w:number,h:number,r:number){
    const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();
  }

  renderNext(){
    ui.next.innerHTML='';
    for(const g of this.next){const el=document.createElement('div');el.className='gem-preview';el.style.background=COLORS[g];ui.next.appendChild(el);}
  }

  updateUi(){ui.score.textContent=this.score.toLocaleString();ui.level.textContent=String(this.level);ui.chain.textContent=this.chain>1?`×${this.chain}`:'—';}

  togglePause(){if(this.over)return;this.paused=!this.paused;ui.pause.textContent=this.paused?'▶':'Ⅱ';ui.overlay.hidden=!this.paused;if(this.paused){ui.overlayKicker.textContent='PAUSED';ui.overlayTitle.textContent='Swifter';ui.overlayCopy.textContent='Tap play to continue.';} }

  gameOver(){this.over=true;ui.overlay.hidden=false;ui.overlayKicker.textContent='GAME OVER';ui.overlayTitle.textContent='Nice run.';ui.overlayCopy.textContent=`Score ${this.score.toLocaleString()} · Level ${this.level}`;}

  wait(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));}

  bind(){
    ui.left.addEventListener('click',()=>this.move(-1));ui.right.addEventListener('click',()=>this.move(1));ui.cycle.addEventListener('click',()=>this.cycle());ui.drop.addEventListener('click',()=>this.hardDrop());ui.restart.addEventListener('click',()=>this.reset());ui.pause.addEventListener('click',()=>this.togglePause());
    window.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowDown','ArrowUp',' ','KeyX','KeyZ'].includes(e.code))e.preventDefault();if(e.repeat&&e.code!=='ArrowDown')return;switch(e.code){case'ArrowLeft':this.move(-1);break;case'ArrowRight':this.move(1);break;case'ArrowUp':case'KeyX':case'KeyZ':this.cycle();break;case'ArrowDown':this.softDrop=true;break;case'Space':this.hardDrop();break;case'KeyP':this.togglePause();break;}});
    window.addEventListener('keyup',e=>{if(e.code==='ArrowDown')this.softDrop=false;});
    canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);this.pointerStart={x:e.clientX,y:e.clientY,t:performance.now()};});
    canvas.addEventListener('pointerup',e=>{if(!this.pointerStart)return;const dx=e.clientX-this.pointerStart.x,dy=e.clientY-this.pointerStart.y,dist=Math.hypot(dx,dy);if(dist<18){this.cycle();}else if(Math.abs(dx)>Math.abs(dy)){this.move(dx>0?1:-1);}else if(dy>20){this.hardDrop();}this.pointerStart=undefined;});
    canvas.addEventListener('pointercancel',()=>{this.pointerStart=undefined;});
    window.addEventListener('resize',()=>this.draw());
  }
}

new Game();
