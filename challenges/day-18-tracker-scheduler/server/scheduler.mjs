import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Store } from './store.mjs';
import { searchIssues } from './tracker.mjs';
import { PublicError, localDate } from './domain.mjs';
import { ZONE } from './config.mjs';

export function localClock(now) {
  const date = localDate(now);
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  return { date, time:parts, weekday:new Date(date+'T12:00:00Z').getUTCDay() };
}
export function nextRun(schedule, now = new Date(), completedToday = false) {
  if (!schedule.enabled) return null;
  const current = localClock(now);
  for (let day=0;day<8;day++) {
    const date = new Date(Date.parse(current.date)+day*86400000).toISOString().slice(0,10);
    const weekday = new Date(date+'T12:00:00Z').getUTCDay();
    if (weekday > 0 && weekday < 6 && (day > 0 || (!completedToday && current.time < schedule.time))) return `${date} ${schedule.time} · Екатеринбург`;
  }
}
export class Scheduler {
  constructor({ directory, collect=searchIssues, now=()=>new Date() } = {}) {
    const store = new Store(directory); this.now=now; this.collect=collect; this.running=false;
    this.db=new DatabaseSync(join(store.directory,'scheduler.sqlite'));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, source TEXT NOT NULL, slot TEXT NOT NULL, trigger TEXT NOT NULL, status TEXT NOT NULL, started TEXT NOT NULL, finished TEXT, attempts INTEGER NOT NULL DEFAULT 1, retry_after TEXT, result TEXT, error TEXT, UNIQUE(source,slot));");
    this.db.prepare('INSERT OR IGNORE INTO settings(id,value) VALUES(1,?)').run(JSON.stringify({source:'demo',enabled:false,time:'09:00'}));
    this.db.prepare("UPDATE runs SET status='failed',error='Выполнение было прервано перезапуском.',retry_after=? WHERE status='running'").run(now().toISOString());
  }
  settings() {return JSON.parse(this.db.prepare('SELECT value FROM settings WHERE id=1').get().value);}
  configure(value) {
    if(!['demo','live'].includes(value.source) || typeof value.enabled!=='boolean' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw new PublicError('Неверные параметры расписания.');
    const schedule={source:value.source,enabled:value.enabled,time:value.time};
    this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(schedule));
    return this.view();
  }
  view() {
    const schedule=this.settings();
    const history=this.db.prepare('SELECT id,source,slot,trigger,status,started,finished,attempts,error FROM runs WHERE source=? ORDER BY started DESC, rowid DESC LIMIT 30').all(schedule.source);
    const row=this.db.prepare("SELECT result,finished FROM runs WHERE source=? AND status='completed' ORDER BY finished DESC LIMIT 1").get(schedule.source);
    const completedToday=Boolean(this.db.prepare("SELECT id FROM runs WHERE source=? AND slot=? AND status='completed'").get(schedule.source,localDate(this.now())));
    return {schedule,nextRun:nextRun(schedule,this.now(),completedToday),running:this.running,history,latest:row?{...JSON.parse(row.result),finished:row.finished}:null};
  }
  async run({trigger='manual',slot,source=this.settings().source}={}) {
    if(this.running) throw new PublicError('Сводка уже формируется.');
    const now=this.now(), actualSlot=slot??`manual-${randomUUID()}`;
    this.db.exec('BEGIN IMMEDIATE');
    let id;
    try {
      const existing=this.db.prepare('SELECT * FROM runs WHERE source=? AND slot=?').get(source,actualSlot);
      if(existing && (existing.status!=='failed' || existing.attempts>=3 || (existing.retry_after && existing.retry_after>now.toISOString()))) {this.db.exec('COMMIT');return {skipped:true};}
      id=existing?.id??randomUUID();
      if(existing) this.db.prepare("UPDATE runs SET status='running',started=?,finished=NULL,error=NULL,attempts=attempts+1 WHERE id=?").run(now.toISOString(),id);
      else this.db.prepare("INSERT INTO runs(id,source,slot,trigger,status,started) VALUES(?,?,?,?,'running',?)").run(id,source,actualSlot,trigger,now.toISOString());
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    this.running=true;
    try {
      const result=await this.collect({source,period:'all',date:localDate(now)});
      this.db.prepare("UPDATE runs SET status='completed',finished=?,result=? WHERE id=?").run(this.now().toISOString(),JSON.stringify(result),id);
      return result;
    }catch(error){
      const message=error instanceof PublicError?error.message:'Не удалось собрать сводку.';
      const attempts=this.db.prepare('SELECT attempts FROM runs WHERE id=?').get(id).attempts;
      this.db.prepare("UPDATE runs SET status='failed',finished=?,retry_after=?,error=? WHERE id=?").run(this.now().toISOString(),new Date(this.now().getTime()+(attempts===1?60000:300000)).toISOString(),message,id);
      throw new PublicError(message);
    }finally{this.running=false;}
  }
  async tick() {
    const schedule=this.settings(), current=localClock(this.now());
    if(!schedule.enabled || this.running || current.weekday===0 || current.weekday===6 || current.time<schedule.time) return;
    await this.run({trigger:'scheduled',source:schedule.source,slot:current.date});
  }
  start(interval=5000) {
    if(this.timer) return;
    const tick=()=>{if(!this.running)this.pending=this.tick().catch(()=>{});};
    this.timer=setInterval(tick,interval);this.timer.unref();tick();
  }
  async close() {clearInterval(this.timer);await this.pending;this.db.close();}
}
