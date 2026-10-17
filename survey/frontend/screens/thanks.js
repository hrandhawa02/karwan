export function render() {
  return `
    <div class="thanks">
      <div class="done" aria-hidden="true"></div>
      <h1>Thank you.</h1>
      <p class="copy">Your response has been recorded.</p>
      <p class="copy">A note like this is how Karwan gets better.</p>
    </div>
    <div class="actions stack">
      <div class="thanks-pair">
        <button type="button" class="share" id="share">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5"/>
          </svg>
          Share
        </button>
        <button type="button" class="download" id="download">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11M7 11l5 5 5-5M5 19h14"/>
          </svg>
          Save
        </button>
      </div>
      <button type="button" class="another" id="another">Add another visit</button>
    </div>
  `;
}
