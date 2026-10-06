import{Store}from'../server/core.mjs';import{getTask}from'../server/chat.mjs';
const store=new Store();try{const task=getTask(store,process.argv[2]);console.log(JSON.stringify({state:task.state,messages:task.messages.length,revision:task.revision}));}finally{store.close();}
