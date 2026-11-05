import { useState } from "react";
import type { NavBadges } from "../../hooks/useNavBadges";
import { useNotifications } from "../NotificationHost";
import Button from "../ui/Button";
import Icon from "../ui/Icon";
import { AlertsDialog } from "./AlertDialogs";
import { SoundSettingsDialog } from "./HeaderDialogs";

interface LiveStripProps {
  badges: NavBadges;
  /** Booking counts and reminders are shown only when the role can open Bookings. */
  canOpenBookings: boolean;
  onNavigate: (page: string) => void;
  onOpenBooking: (id: string) => void;
}

/** Reference live strip: new bookings · assignment pending, reminders, alert sound and sound settings. */
export default function LiveStrip({ badges, canOpenBookings, onOpenBooking }: LiveStripProps) {
  const { soundOn, setSoundOn, audio } = useNotifications();
  const [sheet, setSheet] = useState<"reminders" | "sounds" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const soundBlocked = audio === "unsupported";

  return (
    <>
      <div className="ds-live-strip" role="region" aria-label="Live status">
        <span>
          <Icon name="calendar-clock" />
          {canOpenBookings ? (
            <>
              <b>{badges.newBookings}</b> new bookings
              <span className="ds-separator" aria-hidden="true" />
              <b>{badges.awaitingAssignment}</b> assignment pending
            </>
          ) : (
            <>Live status</>
          )}
        </span>
        <div>
          {canOpenBookings && (
            <Button variant="ghost" size="sm" icon="alarm-clock" onClick={() => setSheet("reminders")}>
              Assignment reminders
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={soundOn ? "volume-2" : "volume-x"}
            className={soundOn ? undefined : "text-brand"}
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              setNotice(next ? "Sound enabled for this tab. Use Test sound to check the office speaker volume." : "Sound turned off for this tab.");
            }}
            aria-pressed={soundOn}
            disabledReason={soundBlocked ? "This browser does not support alert sounds." : undefined}
          >
            {soundOn ? (audio === "locked" ? "Sound on · click page once" : "Sound on") : "Enable sound"}
          </Button>
          <Button variant="ghost" size="sm" icon="sliders-horizontal" onClick={() => setSheet("sounds")}>
            Sound settings
          </Button>
        </div>
      </div>
      {notice && (
        <div className="ds-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="ds-link" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {sheet === "reminders" && <AlertsDialog onClose={() => setSheet(null)} onOpenBooking={onOpenBooking} />}
      {sheet === "sounds" && <SoundSettingsDialog onClose={() => setSheet(null)} />}
    </>
  );
}
