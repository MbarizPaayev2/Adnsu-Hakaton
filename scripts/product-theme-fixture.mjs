/** Synthetic read-only UI fixtures; never a production API replacement.
 * Run this on loopback, then start a separate Next preview with
 * NEXT_PUBLIC_API_URL=http://127.0.0.1:4097. No DB, sends or mutation routes.
 */
import { createServer } from 'node:http';
const date='2026-10-03T10:00:00.000Z';
const user={id:'ui-fixture',email:'candidate@example.test',name:'Leyla — Nümunə'};
const company={id:'example-company',name:'Nümunə Studio',status:'APPROVED',industry:'Texnologiya',description:'Yalnız vizual yoxlama üçün sintetik şirkət.',website:null,logo:null,_count:{vacancies:2}};
const jobs=[['frontend','Frontend mühəndisi','technology'],['analyst','Maliyyə analitiki','finance'],['designer','Məhsul dizayneri','technology']].map(([id,title,category])=>({id,kind:'imported',source:'example',category,categoryLabel:category==='finance'?'Maliyyə və Mühasibat':'IT və Texnologiya',title,company:company.name,companyId:null,location:'Bakı',postedAt:date,deadline:null,checkedAt:date,workArrangement:null,experienceLevel:null,applicationMethod:'EXTERNAL',url:'https://example.test/vacancy',description:'Sintetik elan. Yalnız interfeysin vizual yoxlanması üçün göstərilir.\n\nKomanda ilə birlikdə məhsul üzərində çalışın.',externalId:'example:'+id,ingestedAt:date}));
const matches=jobs.map((job,i)=>({id:'match-'+i,actionable:true,score:[.654,.621,.613][i],status:'NEW',createdAt:date,job,tailoredResumes:[],details:{matchedKeywords:['TypeScript','React'],gaps:[]}}));
const profile={...user,headline:'Frontend mühəndisi',location:'Bakı',skills:['TypeScript','React'],experiences:[],education:[],languages:[],onboardingCompleted:true,onboardingCompletedAt:date,jobPreferences:{roles:['Frontend Developer'],locations:['Bakı'],types:[]}};
const vacancies=jobs.slice(0,2).map(j=>({...j,status:'ACTIVE',companyId:company.id,_count:{applications:1}}));
const routes={
 '/auth/login':{user,sessionToken:'local-visual-fixture'},'/notifications':[{id:'notification',read:false,title:'Nümunə bildiriş',body:'Vizual yoxlama',message:'Vizual yoxlama',createdAt:date}],
 '/dashboard/summary':{user,plan:'FREE',stats:{totalMatches:3,newMatches:3,totalResumes:1},recentMatches:matches},
 '/profile':profile,'/resumes':[{id:'resume-example',isBase:true,status:'READY',fileUrl:null,parsedContent:{name:user.name},version:1,createdAt:date}],
 '/matches':matches,'/external-applications/capabilities':{},'/external-applications/mine':[], '/email-applications':[], '/dashboard/applications':[],
 '/billing/status':{paymentsEnabled:false},'/billing/subscription':{plan:'FREE',subscriptionPlan:'FREE',status:'active',currentPeriodEnd:null,cancelAtPeriodEnd:false,matchesUsedThisPeriod:3,providerManaged:false,override:null},'/companies':[company],
 '/jobs':{data:jobs,meta:{total:3,totalOpen:3,page:1,limit:20,totalPages:1},sources:[{source:'example',count:3}],categories:[{key:'technology',label:'IT və Texnologiya',count:2},{key:'finance',label:'Maliyyə və Mühasibat',count:1}],companies:[{company:company.name,count:3}],workArrangements:[],experienceLevels:[]},
 '/business/auth/me':{...user,email:'employer@example.test'},'/business/company':company,'/business/vacancies':vacancies,'/business/applications':[{id:'application-example',candidateName:'Nümunə namizəd',vacancyTitle:jobs[0].title,status:'REVIEWING',createdAt:date}],
 '/admin/auth/me':{id:'operator-example',name:'Nümunə operator',email:'operator@example.test',role:'SUPER_ADMIN',mfaEnabled:true,environment:'local-fixture',permissions:['ops.read','companies.read','users.read','listings.read','applications.read','audit.read','operators.manage','self']},
 '/admin/ops/overview':{users:{total:12,verified:10,suspended:0},companies:{APPROVED:4,PENDING:1},vacancies:{ACTIVE:3},jobs:{ACTIVE:3,CLOSED:0,hidden:0},applications:{native:{REVIEWING:1},external:{}},matchesLast24h:3,failures:{tailoredCvLast7d:0,externalUnconfirmed:0,queues:[],emailFailuresSinceRestart:0},lastImport:null,features:[]},
 '/admin/ops/health':{environment:'local-fixture',release:{sha:null,builtAt:null},uptimeSeconds:120,services:Object.fromEntries(['database','redis','matching','applyWorker'].map(k=>[k,{ok:true,ms:2}])),backup:{known:false,reason:'Sintetik interfeys nümunəsi'}},
};
for(const job of jobs) routes['/jobs/imported/'+job.id]=job;
createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3471');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(req.method!=='GET' && path!=='/auth/login'){res.writeHead(405);return res.end();}
 if(!(path in routes)){res.writeHead(404);return res.end(JSON.stringify({message:'No visual fixture for this route'}));}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(routes[path]));
}).listen(4097,'127.0.0.1',()=>console.log('Synthetic UI fixture on loopback 4097; no database, mail or writes.'));
