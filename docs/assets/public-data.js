import {initializeApp} from './vendor/firebase-app.js';
import {getFirestore,doc,getDoc,getDocs,collection,query,where,limit,startAfter,connectFirestoreEmulator} from './vendor/firebase-firestore.js';
const base=new URL('../',import.meta.url),cfg=await (await fetch(new URL('firebase-config.json',base))).json(),db=getFirestore(initializeApp(cfg,'siyasat-existing-reader'));
if(cfg.useEmulators){if(!['localhost','127.0.0.1'].includes(location.hostname))throw Error('محاكي محلي فقط');connectFirestoreEmulator(db,'127.0.0.1',8989)}
const domains={work:'employment','التشغيل':'employment','الاقتصاد':'economy','الحكامة':'governance'};
const normalize=d=>({id:d.id,...d.data(),domain:domains[d.data().domain||d.data().category]||d.data().domain||d.data().category||''});
export async function listLegacy(after){const parts=[where('status','==','published'),limit(50)];if(after)parts.push(startAfter(after));const s=await getDocs(query(collection(db,'siyasat_reports'),...parts));return {rows:s.docs.map(normalize),cursor:s.docs.at(-1)}}
export async function getPublic(id){try{if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw Error();const s=await getDoc(doc(db,'siyasat_reports',id));if(!s.exists()||s.data().status!=='published')throw Error();return normalize(s)}catch{throw Error('المقال ما تلقاش')}}
