const path=require('node:path'),{execFileSync}=require('node:child_process');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Package the signed native Apple Silicon candidate on its release host.');
if(!process.env.MATIQ_TOOL_SIGNING_KEY)throw Error('Supply the existing protected tool release signing key; never write it into source or arguments.');
const root=path.join(__dirname,'..'),version=require('../package.json').version;
const file='MatiQ-Guides-'+version+'-darwin-arm64.mqt';
execFileSync(process.execPath,[require.resolve('@matiq-solutions/sdk/cli.cjs'),'pack-app','--resources',path.join(root,'dist/mac-arm64/MatiQ Guides.app/Contents/Resources'),'--extra','native','--target','darwin-arm64','--output',path.join(root,'dist',file),'--url','https://github.com/GoMatiQ-inc/matiq-guides/releases/download/v'+version+'/'+file],{cwd:root,env:process.env,stdio:'inherit',timeout:120000});
