const vscode = require('vscode');
const utils = require('./utils');

function handleShowSession(panel, service) {
  // Retrieve the session data and current index based on the service
  const sessionData = service === "chatGpt" ? global.chatSessionGPT : global.chatSessionGemini;
  const currentIndex = global.currentChatIndex[service];

  // Define totalEntries based on the length of the session data
  const totalEntries = sessionData.length;

  // Build session text for the current index, or a placeholder if the session is empty
  let sessionText = sessionData.length > 0 ? sessionData[currentIndex].content : "Session is empty.";

  if (panel && panel.webview) {
    let command = service === "chatGpt" ? 'updateChatGptOutput' : 'updateGeminiOutput';
    const sessionHtml = utils.formatMarkdown(sessionText, false);
    const navigationHtml = `
      <div style="display: flex; justify-content: center;">
        <button style="margin-right: 10px;" ${currentIndex === 0 ? 'disabled' : ''} onclick="navigateChat('prev')">&lt; Previous</button>
        <button ${currentIndex >= totalEntries - 1 ? 'disabled' : ''} onclick="navigateChat('next')">Next &gt;</button>
      </div>
    `;
    panel.webview.postMessage({
      command: command,
      htmlContent: `<div>${sessionHtml} ${navigationHtml}</div>`
    });
  }
}


function handleClearSession(panel, service) {
  // Clear the chat session array
  let command = service == "chatGpt" ? 'updateChatGptOutput' : 'updateGeminiOutput';
  if (service == "chatGpt") {
    global.chatSessionGPT = [];
  } else if (service == "gemini") {
    global.chatSessionGemini = [];
  }
  // Notify the webview that the session has been cleared
  if (panel && panel.webview) {
    panel.webview.postMessage({
      command: command,
      htmlContent: `<div>Session cleared.</div>`
    });
  }
  vscode.window.showInformationMessage('Session cleared');
}

module.exports = {
  handleShowSession,
  handleClearSession
};