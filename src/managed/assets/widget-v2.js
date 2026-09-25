export function mount(config) {
  const sdk = globalThis.LaunchLab;
  if (!sdk?.configure) throw new Error('LaunchLab tracking SDK is unavailable.');
  sdk.configure(config);
  const root = document.createElement('div'); root.id = '__launchlab'; document.body.append(root);
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<link rel="stylesheet" href="/__launchlab/widget.css"><aside class="consent" aria-label="Optional experiment tracking"><p>Help improve this demo. Allow anonymous visits and defined product actions? We do not capture typed inputs, wallet details or contact information. Records expire after 90 days.</p><div><button id="allow">Allow</button><button id="skip" class="quiet">No thanks</button></div></aside><button class="launcher">Share feedback</button><dialog aria-labelledby="ll-title"><button class="close quiet" aria-label="Close feedback">Close ×</button><h2 id="ll-title">Help shape this product</h2><p class="hypothesis"></p><p class="note">Candid criticism is welcome. Responses may be summarized using AI. Leave out personal information. No reward is paid by this form.</p><form><label>Would you consider using this?<select name="intent" required><option value="">Choose</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></label><label>What is your main hesitation?<select name="blocker" required><option value="">Choose</option><option value="none">Nothing so far</option><option value="price">Price</option><option value="usefulness">Usefulness</option><option value="ease">Ease of use</option><option value="trust">Trust</option><option value="other">Something else</option></select></label><div class="questions"></div><label>Anything else? (optional)<textarea name="comment" maxlength="800" rows="2"></textarea></label><label>Were you offered an incentive to try this?<select name="rewarded" required><option value="no">No</option><option value="yes">Yes</option></select></label><button type="submit">Send feedback</button><p class="feedback-status" role="status" aria-live="polite"></p></form><button class="preferences quiet">Tracking preferences</button><p class="tracking-status note" role="status"></p></dialog>`;
  const $ = (s) => shadow.querySelector(s);
  $('.hypothesis').textContent = config.hypothesis;
  for (const question of config.experiment.questions) {
    const label = document.createElement('label'); label.textContent = question.label + (question.kind === 'text' ? ' (optional)' : '');
    const input = document.createElement(question.kind === 'choice' ? 'select' : 'textarea'); input.name = 'answer:' + question.id;
    if (question.kind === 'choice') {
      input.required = true; input.add(new Option('Choose', ''));
      for (const option of question.options) input.add(new Option(option.label, option.id));
    } else { input.maxLength = 800; input.rows = 2; }
    label.append(input); $('.questions').append(label);
  }
  $('.consent').hidden = sdk.state().consentKnown;
  $('.launcher').onclick = () => $('dialog').showModal(); $('.close').onclick = () => $('dialog').close();
  $('.preferences').onclick = () => { $('dialog').close(); $('.consent').hidden = false; };
  $('#allow').onclick = () => { sdk.setConsent(true); $('.consent').hidden = true; };
  $('#skip').onclick = () => { sdk.setConsent(false); $('.consent').hidden = true; };
  sdk.subscribe(({ message }) => { $('.tracking-status').textContent = message; });
  $('.tracking-status').textContent = sdk.state().tracking ? 'Anonymous activity tracking is on.' : 'Tracking is off. Feedback still works.';
  $('form').onsubmit = async (event) => {
    event.preventDefault(); const button = $('button[type=submit]'); button.disabled = true;
    $('.feedback-status').textContent = 'Saving…';
    try {
      const form = Object.fromEntries(new FormData($('form'))), answers = {};
      for (const q of config.experiment.questions) answers[q.id] = form['answer:' + q.id] || '';
      await sdk.feedback({ intent: form.intent, blocker: form.blocker, rewarded: form.rewarded, comment: form.comment, answers });
      $('.feedback-status').textContent = 'Saved. Thank you. Submitting again updates your answer.';
    } catch (error) { $('.feedback-status').textContent = error.message; }
    finally { button.disabled = false; }
  };
}
