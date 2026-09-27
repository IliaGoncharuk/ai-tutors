import {McpConnection} from './mcp-client.mjs';import {trackerConfig} from './tracker.mjs';
export class Connections{
 constructor(source,directory){
  const c=trackerConfig(),common={TRACKER_SOURCE:source,TRACKER_LAB_DATA_DIR:directory};
  this.data=new McpConnection({env:{...common,MCP_ROLE:'data',...(source==='live'?{...(c.token?{YANDEX_TRACKER_TOKEN:c.token}:{}),...(c.org?{YANDEX_TRACKER_ORG_ID:c.org}:{}),...(c.cloudOrg?{YANDEX_TRACKER_CLOUD_ORG_ID:c.cloudOrg}:{})}:{})}});
  this.analytics=new McpConnection({env:{...common,MCP_ROLE:'analytics'}});
 }
 async connect(){try{await this.data.connect();await this.analytics.connect();}catch(error){await this.close();throw error;}}
 view(){return [{id:'data',title:'Задачи Трекера',...this.data.view()},{id:'analytics',title:'Аналитика Трекера',...this.analytics.view()}];}
 catalog(){return this.view().flatMap(server=>server.tools.map(tool=>({server:server.id,tool,alias:`${server.id}__${tool.name}`})));}
 async close(){await this.data.close();await this.analytics.close();}
}
