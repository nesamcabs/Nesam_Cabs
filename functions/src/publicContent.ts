// User-approved public fields only. Contacts, moderation notes, contract rates and partner payouts are never copied.
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { requirePermission } from './shared';
const kinds=['reviews','services','tour_packages','locations'] as const;
type Kind=typeof kinds[number];
const str=(v:unknown,n=500)=>typeof v==='string'?v.trim().slice(0,n):'';
const https=(v:unknown)=>/^https:\/\//i.test(str(v,2000))?str(v,2000):'';
export function publicContent(kind:Kind,id:string,d:Record<string,any>|undefined):Record<string,unknown>|null {
  if(!d)return null;
  if(kind==='reviews') {
    if(d.status!=='Published'||!Number.isInteger(d.overallRating)||d.overallRating<1||d.overallRating>5)return null;
    return {kind,id,name:str(d.customerName,80).split(/\s+/)[0]||'Traveller',rating:d.overallRating,text:str(d.reviewText),response:str(d.adminResponse?.text),service:str(d.serviceName,80)};
  }
  if(d.status!=='Active')return null;
  const base={kind,id,name:str(d.name,120),description:str(d.shortDescription||d.description),imageUrl:https(d.imageUrl),order:Number.isFinite(d.displayOrder)?d.displayOrder:999};
  if(kind==='services')return {...base,serviceType:str(d.serviceType,60),onlineBookingEnabled:d.onlineBookingEnabled===true};
  if(kind==='locations')return {...base,type:str(d.type,40),city:str(d.city,80),state:str(d.state,80)};
  return {...base,basePrice:typeof d.basePrice==='number'&&Number.isFinite(d.basePrice)?d.basePrice:null,duration:str(d.duration,80),destination:str(d.destination,120)};
}
export async function syncPublicContent(kind:Kind,id:string):Promise<void> {
  await db.runTransaction(async tx=>{
    const ref=db.doc(`public_content/${kind}_${id}`);
    const [source,prior]=await Promise.all([tx.get(db.doc(`${kind}/${id}`)),tx.get(ref)]);
    const data=publicContent(kind,id,source.data());
    if(data) {
      const old=prior.data()??{};
      if(Object.keys(old).filter(k=>k!=='updatedAt').length===Object.keys(data).length&&Object.entries(data).every(([k,v])=>old[k]===v))return;
      tx.set(ref,{...data,updatedAt:FieldValue.serverTimestamp()});
    } else if(prior.exists)tx.delete(ref);
  });
}
export const onPublicReviewWritten=onDocumentWritten('reviews/{id}',e=>syncPublicContent('reviews',e.params.id));
export const onPublicServiceWritten=onDocumentWritten('services/{id}',e=>syncPublicContent('services',e.params.id));
export const onPublicPackageWritten=onDocumentWritten('tour_packages/{id}',e=>syncPublicContent('tour_packages',e.params.id));
export const onPublicLocationWritten=onDocumentWritten('locations/{id}',e=>syncPublicContent('locations',e.params.id));
export const refreshPublicContent=onCall(async request=>{
  const kind=request.data?.kind as Kind,id=request.data?.id;
  if(!kinds.includes(kind)||typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new HttpsError('invalid-argument','Invalid content record.');
  await requirePermission(request.auth,kind==='reviews'?'engagement':'content');
  await syncPublicContent(kind,id);return {ok:true};
});
/** Backfills existing masters and handles edits on HTTP-only hosting. */
export async function reconcilePublicContent():Promise<void> {
  for(const kind of kinds) {
    let cursor:FirebaseFirestore.QueryDocumentSnapshot|undefined;
    for(;;) {
      const q=db.collection(kind).orderBy('__name__').limit(200);
      const rows=await (cursor?q.startAfter(cursor):q).get();
      await Promise.all(rows.docs.map(d=>syncPublicContent(kind,d.id)));
      if(rows.size<200)break;cursor=rows.docs[rows.docs.length-1];
    }
  }
  const published=await db.collection('public_content').get();
  await Promise.all(published.docs.map(async d=>{const p=d.data();if(kinds.includes(p.kind)&&typeof p.id==='string')await syncPublicContent(p.kind,p.id);}));
}
