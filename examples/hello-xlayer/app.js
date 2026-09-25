let selected;
document.querySelectorAll('[data-service]').forEach((button) =>
  button.addEventListener('click', () => {
    selected = button.dataset.service;
    document.querySelector('#selection').hidden = false;
    document.querySelector('#chosen').textContent = selected;
    document.querySelector('#result').textContent = '';
    document.querySelector('#goal').focus();
  }),
);
document.querySelector('#send').addEventListener('click', () => {
  const goal = document.querySelector('#goal').value.trim();
  document.querySelector('#result').textContent =
    goal.length < 10
      ? 'Tell us a little more about your request (at least 10 characters).'
      : `Request prepared for ${selected}. This prototype stops here—no agent was called. Return to the experiment and share what you expected to happen next.`;
});
