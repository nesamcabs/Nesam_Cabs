// Brings the booking form into view together with the headline above it, clear of the sticky
// header (whatever its height on this screen). Runs again a moment later, in case content above the
// form was still settling and moved it.
export function scrollToBookingForm(): void {
  const go = () => {
    const target = document.querySelector('.home-hero') ?? document.getElementById('book-console');
    const header = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 0;
    const top = target ? target.getBoundingClientRect().top + window.pageYOffset - header - 8 : 0;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };
  go();
  window.setTimeout(go, 120);
}
