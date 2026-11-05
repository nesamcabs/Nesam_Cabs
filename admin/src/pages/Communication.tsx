import { useState } from "react";
import { useCan } from "../components/AccessContext";
import { StageBar } from "../components/ui/ListKit";
import { Icon } from "../components/ui";
import MessagesPanel from "../components/communication/Messages";
import NotificationsPage from "./NotificationsPage";

type Tab = "Messages" | "Inbox";

/** Communication owns messages, notices and the staff inbox; coupons have their own workspace. */
export default function Communication({ onNavigate, initialTab }: { onNavigate: (page: string) => void; initialTab?: string }) {
  const [tab, setTab] = useState<Tab>(initialTab === "Inbox" ? initialTab : "Messages");
  const canSend = useCan("engagement");
  return (
    <div className="ds-page-body">
      <StageBar
        label="Communication"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "Messages", label: <span className="inline-flex items-center gap-2"><Icon name="messages-square" size={15} />Messages &amp; notices</span> },
          { id: "Inbox", label: <span className="inline-flex items-center gap-2"><Icon name="inbox" size={15} />Staff inbox &amp; outbox</span> },
        ]}
      />
      <div className="mt-5">
        {tab === "Messages" && <MessagesPanel canSend={canSend} />}
        {tab === "Inbox" && <NotificationsPage onNavigate={onNavigate} />}
      </div>
    </div>
  );
}
