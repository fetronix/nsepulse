/** The sidebar wordmark. Purely decorative; the accessible name is set by the shell. */
export function Logo() {
  return (
    <div className="brand-lockup">
      <div className="brand-mark" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div>
        <b>NSE PULSE</b>
        <small>MARKET INTELLIGENCE</small>
      </div>
    </div>
  );
}
