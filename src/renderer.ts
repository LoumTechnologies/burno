import './index.css';

// This function will be called when the button is clicked.
// It uses the `window.api` object defined in the preload script.
async function handleSelectFile() {
  const statusText = document.getElementById('status-text');
  const logOutput = document.getElementById('log-output');

  statusText.textContent = 'Waiting for file selection...';
  logOutput.textContent = ''; // Clear previous logs

  // This sends a message to the main process to start the burn process
  const result = await window.api.burnDVD();

  if (result.success) {
    statusText.textContent = 'Success!';
    logOutput.textContent = result.log;
  } else {
    statusText.textContent = 'Error!';
    logOutput.textContent = result.error;
  }
}

// Add the event listener when the window loads
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('select-file-btn').addEventListener('click', handleSelectFile);
});
