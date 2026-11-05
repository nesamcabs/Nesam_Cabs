/** GST state codes (first two digits of a GSTIN) and names, as used on tax invoices and GST returns. */
export const GST_STATES: ReadonlyArray<readonly [string, string]> = [
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"],
  ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"],
  ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"],
  ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"], ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"],
  ["37", "Andhra Pradesh"], ["38", "Ladakh"],
];

/** State code of a GSTIN ("33ABCDE…" → "33"), or null when it is not a valid code. */
export function stateOfGstin(gstin: string | undefined | null): string | null {
  const c = (gstin ?? "").trim().slice(0, 2);
  return GST_STATES.some(([code]) => code === c) ? c : null;
}

export type GstSplit = 'CGST + SGST' | 'CGST + UTGST' | 'IGST';
export function gstSplit(supplier: string, place: string): GstSplit {
  return supplier !== place ? 'IGST' : ['04', '26', '31', '35', '38'].includes(supplier) ? 'CGST + UTGST' : 'CGST + SGST';
}
export function splitGst(total: number, split: GstSplit) {
  const paise = Math.round(total * 100), half = Math.round(paise / 2);
  return { cgst: split === 'IGST' ? 0 : half / 100, sgst: split === 'CGST + SGST' ? (paise - half) / 100 : 0,
    utgst: split === 'CGST + UTGST' ? (paise - half) / 100 : 0, igst: split === 'IGST' ? paise / 100 : 0 };
}
