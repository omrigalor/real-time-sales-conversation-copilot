import WebSocket from 'ws';
// Development-only Realtime replay. Uses the production buyer instructions and
// model, with typed inputs/text outputs; it does not measure voice timing/prosody.
export function buyerReplayRequest(payload, config) {
  return {
    session: {type:'realtime',model:config.model,instructions:config.instructions,output_modalities:['text'],audio:{input:{turn_detection:null}}},
    items: payload.turns.map(turn=>{
      if (!['seller','buyer'].includes(turn.speaker)) throw new Error('Buyer replay needs identified speakers.');
      const buyer=turn.speaker==='buyer';
      return {type:'message',role:buyer?'assistant':'user',content:[{type:buyer?'output_text':'input_text',text:turn.text}]};
    }),
    response:{output_modalities:['text']},
  };
}
export function replayBuyer({key,request,socketFactory=(url,options)=>new WebSocket(url,options),timeoutMs=45000}) {
  return new Promise((resolve,reject)=>{
    let socket,settled=false,configured=false,resolvedModel=request.session.model;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);socket?.close();error?reject(error):resolve(result);};
    const timer=setTimeout(()=>{finish(new Error('Buyer replay timed out.'));socket?.terminate?.();},timeoutMs);
    try { socket=socketFactory(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(request.session.model)}`,{headers:{Authorization:`Bearer ${key}`}}); }
    catch {finish(new Error('Buyer replay connection could not be created.'));return;}
    const send=event=>socket.send(JSON.stringify(event));
    socket.on('open',()=>{
      // Model selection belongs to the connection URL, not a session mutation.
      const {model, ...session}=request.session;
      if(!settled)send({type:'session.update',session});
    });
    socket.on('message',message=>{
      if(settled)return;
      try {
        const event=JSON.parse(message.toString());
        if(event.type==='session.updated'&&!configured){
          configured=true;resolvedModel=event.session?.model||resolvedModel;
          for(const item of request.items)send({type:'conversation.item.create',item});
          send({type:'response.create',response:request.response});
        }
        if(event.type==='error')finish(new Error(`Buyer replay rejected (${event.error?.code||'API error'}).`));
        if(event.type==='response.done'){
          const r=event.response;
          if(r?.status!=='completed'){finish(new Error(`Buyer replay ${r?.status||'missing status'}.`));return;}
          const text=(r.output||[]).flatMap(item=>item.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
          if(!text.trim()){finish(new Error('Buyer replay returned no text.'));return;}
          finish(null,{text,response_id:r.id,model:resolvedModel,usage:r.usage});
        }
      }catch {finish(new Error('Buyer replay event could not be read.'));}
    });
    socket.on('error',()=>finish(new Error('Buyer replay connection failed.')));
    socket.on('close',()=>finish(new Error('Buyer replay disconnected before completion.')));
  });
}
