export function render() {
  return `
    <div class="thanks">
      <div class="done" aria-hidden="true"></div>
      <h1>Thank you.</h1>
      <p class="copy">Your response has been recorded.</p>
      <p class="copy">A note like this is how Karwan gets better.</p>
      <p class="copy thanks-share-prompt">Know someone who was out today?</p>
    </div>
    <div class="actions stack thanks-actions">
      <button
        type="button"
        class="share thanks-primary"
        id="share"
        aria-label="Share link to Karwan so someone else can add their own visit note"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="18" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <circle cx="18" cy="19" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8.2 10.8 15.8 6.5M8.2 13.2l7.6 4.3"/>
        </svg>
        <span class="share-label">Tell a friend</span>
      </button>
      <button
        type="button"
        class="thanks-pdf"
        id="download"
        aria-label="Download a PDF of your visit note"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11M7 11l5 5 5-5M5 19h14"/>
        </svg>
        Keep a PDF copy
      </button>
      <button type="button" class="another" id="another">Add another visit</button>
    </div>
  `;
}
