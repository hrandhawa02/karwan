export function render() {
  return `
    <div class="thanks">
      <div class="done" aria-hidden="true"></div>
      <h1>Thank you.</h1>
      <p class="copy thanks-lead">Your update helps the community plan their day.</p>
      <p class="copy thanks-body">Real-time conditions keep our outdoor spots open, safe, and accessible for everyone.</p>
      <p class="copy thanks-share-prompt">Know someone who was at a trailhead today?</p>
    </div>
    <div class="actions stack thanks-actions">
      <button
        type="button"
        class="share thanks-btn thanks-btn-primary"
        id="share"
        aria-label="Pass Karwan on so someone else can add a lot update"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="18" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <circle cx="18" cy="19" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
          <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8.2 10.8 15.8 6.5M8.2 13.2l7.6 4.3"/>
        </svg>
        <span class="share-label">Pass it on</span>
      </button>
      <button type="button" class="another thanks-btn thanks-btn-secondary" id="another">
        Add another spot update
      </button>
    </div>
    <div class="thanks-tertiary">
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
    </div>
  `;
}
