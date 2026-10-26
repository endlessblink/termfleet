// Exclusive daemon-owned child pipes, not a listener or a public endpoint.
import {readSync,writeSync} from 'node:fs';
import {TextDecoder} from 'node:util';
const decoder=new TextDecoder('utf-8',{fatal:true});
export const MAX_PIPE_PACKET_BYTES=32*1024*1024;
export function jsonLinePipe({input=0,output=1,maxBytes=MAX_PIPE_PACKET_BYTES}={}) {
  let pending=Buffer.alloc(0);
  return Object.freeze({
    read(){
      const chunks=[];let total=0;
      for(;;){
        const end=pending.indexOf(10);
        if(end>=0){
          total+=end;if(total>maxBytes)throw Error('private-pipe-packet-too-large');
          chunks.push(pending.subarray(0,end));pending=pending.subarray(end+1);
          if(!total)throw Error('empty-private-pipe-packet');
          const bytes=Buffer.concat(chunks,total);
          return JSON.parse(decoder.decode(bytes));
        }
        if(pending.length){total+=pending.length;chunks.push(pending);pending=Buffer.alloc(0);}
        if(total>maxBytes)throw Error('private-pipe-packet-too-large');
        const chunk=Buffer.alloc(16384),n=readSync(input,chunk,0,chunk.length,null);
        if(n===0)throw Error(total?'truncated-private-pipe-packet':'private-pipe-eof');
        pending=chunk.subarray(0,n);
      }
    },
    write(packet){
      const bytes=Buffer.from(JSON.stringify(packet)+'\n');
      if(bytes.length-1>maxBytes)throw Error('private-pipe-packet-too-large');
      let offset=0;
      while(offset<bytes.length){const n=writeSync(output,bytes,offset,bytes.length-offset,null);
        if(n===0)throw Error('private-pipe-write-incomplete');offset+=n;}
    },
  });
}
