const vscode = require('vscode');
const utils = require('./utils');

function handleShowContext(panel, service) {
    let command = service == "chatGpt" ? 'updateChatGptOutput' : 'updateGeminiOutput';
    // Retrieve the current contextData
    const contextDataRaw = vscode.workspace.getConfiguration().get('tempContextCode');
    let output = [];
  
    if (contextDataRaw) {
      try {
        // Parse the JSON string
        const contextData = JSON.parse(contextDataRaw);
  
        if (Array.isArray(contextData)) {
          // If contextData is an array, map over it and format each item
          output = contextData.map((data) => {
            // Assuming formatMarkdown returns a string in Markdown syntax
            // that should be converted safely to HTML for display in VS Code Webview
            const contextHtml = utils.formatMarkdown(data.context, true); // sanitize this if needed
            const definitionHtml = utils.formatMarkdown(data.definition, true); // sanitize this if needed
  
            // Return the combined HTML string for each array element
            return `<div><strong>Context:</strong> ${contextHtml}</div> <div><strong>Definition:</strong>${definitionHtml}</div>`;
          });
        }
      } catch (e) {
        console.error('Parsing error:', e);
      }
    }
  
    // You might want to do something with the output, such as joining it, if it's intended to be a single HTML string
    if (output.length) {
      output = output.join(''); // Join all the HTML strings together.
    }
  
    if (contextDataRaw) {
      // Display the current contextData 
      panel.webview.postMessage({
        command: command,
        htmlContent: output
      });
    } else {
      panel.webview.postMessage({
        command: command,
        htmlContent: `<div>No context found.</div>`
      });
    }
  }
  
  function handleClearContext(panel, service) {
    let command = service == "chatGpt" ? 'updateChatGptOutput' : 'updateGeminiOutput';
    // Update the contextCode with an empty array
    vscode.workspace.getConfiguration().update('tempContextCode', JSON.stringify([]), vscode.ConfigurationTarget.Global)
      .then(() => {
        vscode.window.showInformationMessage('Context cleared');
        if (panel && panel.webview) {
          panel.webview.postMessage({
            command: command,
            htmlContent: `<div>Context cleared.</div>`
          });
        }
      }, err => {
        console.error('Error clearing contextCode:', err);
        vscode.window.showErrorMessage('Failed to clear context');
      });
  }
  
module.exports = {
    handleShowContext,
    handleClearContext
};  

