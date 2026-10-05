const fs=require('fs'),path=require('path');const P=__dirname;const A=require('./stack-avatars.js');
const records=[];for(const m of A.memberIds)for(const theme of ['light','dark'])for(const state of A.states)for(const size of [32,48])records.push({member:m,theme,state,size,svg:A.toString({id:m,member:m,theme,state,size,projectColor:A.palette.sage})});
fs.writeFileSync(path.join(P,'render-inputs.json'),JSON.stringify(records));
