import { useEffect, useState } from "react";
import { pincodesOf, type PincodeList } from "../domain/pincodes";

/**
 * The pincode choice of a "where" picker. Choosing a city loads its pincodes, all ticked:
 *   - all ticked (or a city with no pincode list) = the whole city: one place, `area: ""`;
 *   - fewer ticked = only those pincodes: one place each, `area: "<pincode>"`.
 * `areas` is what to create: [""] for the whole city, else the ticked pincodes in list order.
 */
export function usePincodeScope(state: string, city: string) {
  // undefined while loading, null when there is no list (no city chosen, or no pincode data for it).
  const [list, setList] = useState<PincodeList | null | undefined>(null);
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    setPins([]);
    if (!state || !city) { setList(null); return undefined; }
    let current = true;
    setList(undefined);
    void pincodesOf(state, city).then((found) => { if (current) { setList(found); setPins(found ? found.pins.map((p) => p.pin) : []); } });
    return () => { current = false; };
  }, [state, city]);

  const total = list?.pins.length ?? 0;
  const whole = !city || !list || pins.length === total;
  /** Something can be added: no city needed, or the list has loaded and at least one pincode is ticked. */
  const canAdd = !city || (list !== undefined && (!list || pins.length > 0));
  const areas = whole ? [""] : (list?.pins ?? []).filter((p) => pins.includes(p.pin)).map((p) => p.pin);
  return { list, pins, setPins, whole, canAdd, areas };
}
