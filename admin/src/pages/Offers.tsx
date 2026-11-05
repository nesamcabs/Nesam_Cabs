import CouponsPanel from "../components/communication/Coupons";
import { useCan, useCanDo } from "../components/AccessContext";
import { useState } from "react";
import { StageBar } from "../components/ui/ListKit";
import LegacyCoupons from "./LegacyCoupons";

/** One coupon workspace; writes keep the existing pricing and Settings-edit permissions. */
export default function Offers() {
  const pricing = useCan("pricing");
  const editSettings = useCanDo("Settings", "edit");
  const operations = useCan("operations");
  const viewSettings = useCanDo("Settings", "view");
  const [tab, setTab] = useState<"current" | "legacy">("current");
  const canViewLegacy = pricing && viewSettings;
  return <div className="ds-page-body">
    {canViewLegacy && <StageBar label="Coupon workspace" value={tab} onChange={setTab} tabs={[{ id: "current", label: "Customer campaigns" }, { id: "legacy", label: "Legacy coupon records" }]} />}
    {tab === "legacy" && canViewLegacy
      ? <LegacyCoupons canEdit={pricing && editSettings} />
      : <CouponsPanel canEdit={pricing && editSettings} canSeeUsage={operations} includeLegacy={!canViewLegacy} />}
  </div>;
}
