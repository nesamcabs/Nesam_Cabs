/**
 * Plays one of the three tones the customer, driver and vendor apps play, in this browser only (the Test buttons of the
 * Notification sounds window). The files in public/sounds/app are copies of the apps' bundled tones
 * (user/app, driver and vendor assets/sounds — the same three files in every app).
 */
export type AppTone = "new_booking" | "approval" | "general";

let current: HTMLAudioElement | null = null;

export function stopAppTone(): void {
  const a = current;
  current = null;
  if (!a) return;
  a.onended = null;
  a.pause();
}

/** Rejects with a clear message when the browser blocks or cannot play the file. */
export async function playAppTone(tone: AppTone): Promise<void> {
  stopAppTone();
  const a = new Audio(`${import.meta.env.BASE_URL}sounds/app/${tone}.wav`);
  current = a;
  a.onended = () => { if (current === a) current = null; };
  try {
    await a.play();
  } catch {
    if (current === a) current = null;
    throw new Error("The tone could not be played. Allow sound for this site and try again.");
  }
}
