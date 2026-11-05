import { collection, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
export interface PublicContent {id:string;kind:'reviews'|'services'|'locations'|'tour_packages';name:string;description?:string;imageUrl?:string;order?:number;serviceType?:string;onlineBookingEnabled?:boolean;basePrice?:number|null;rating?:number;text?:string;response?:string;service?:string;city?:string;state?:string}
export function subscribePublicContent(kind:PublicContent['kind'],cb:(rows:PublicContent[])=>void,onError?:(message:string)=>void):()=>void {
  return onSnapshot(query(collection(db,'public_content'),where('kind','==',kind),limit(50)),snapshot=>{
    cb(snapshot.docs.map(d=>d.data() as PublicContent).sort((a,b)=>(a.order??999)-(b.order??999)||a.name.localeCompare(b.name)));
  },()=>onError?.('This section is temporarily unavailable. Please contact NESAM for details.'));
}
