const vscode = require('vscode');
const {
  getWebviewContent,
  handleDelete,
  handleSelect,
  handleSaveDefinition,
  updateWebview,
  handleRefreshDefinition,
} = require('./webview');
const {
  handleShowContext,
  handleClearContext,
} = require('./context');
const {
  handleShowSession,
  handleClearSession,
} = require('./session');
const {
  handleGPTSubmitInput,
  handleGeminiSubmitInput,
} = require('./chat');
const { handleAddImgContext } = require('./file_ctx');
const {
  getRelativeFilePath,
  executeCommandFromSuggestion,
} = require('./utils');
const {
  handleApplySuggestions,
  handleApplyOneSuggestion,
} = require('./diff');

let panel;
let currentPage = 1;
global.chatSessionGPT = [];
global.chatSessionGemini = [];
global.currentChatIndex = {
  chatGpt: 0,
  gemini: 0,
};

async function addSecretKey() {
  const secretKey = await vscode.window.showInputBox({
    prompt: 'Enter your secret key',
    ignoreFocusOut: true, // The input box will not be dismissed when focus moves to another part of the editor
  });
  if (!secretKey) {
    vscode.window.showErrorMessage('No secret key provided');
    return;
  }
  try {
    await vscode.workspace.getConfiguration().update('secretKey', secretKey, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage('Secret key added successfully');
  } catch (error) {
    console.error('Error updating secretKey:', error);
    vscode.window.showErrorMessage('Failed to add secret key');
  }
}

function activate(context) {
  let addDisposable = vscode.commands.registerCommand('extension.addSelectedContext', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.selection) {
      let selectedText = editor.document.getText(editor.selection);

      // Escape special characters or sanitize the selected text
      // This can be adjusted based on the specific requirements
      selectedText = selectedText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      // Retrieve the file name from the active editor
      const fileName = getRelativeFilePath();

      // Retrieve the current contextCode
      const currentContextRaw = vscode.workspace.getConfiguration().get('contextCode');
      let currentContext = [];

      if (currentContextRaw) {
        try {
          // Parse the existing JSON array if it exists
          currentContext = JSON.parse(currentContextRaw);
        } catch (err) {
          console.error('Error parsing existing contextCode:', err);
          // Fallback to an empty array if parsing fails
          currentContext = [];
        }
      }

      // Create new context object including the file name
      const newContextObj = {
        "context": selectedText,
        "definition": "",
        "fileName": fileName
      };

      // Add the new context object
      currentContext.push(newContextObj);

      // Update the contextCode with the new array
      vscode.workspace.getConfiguration().update('contextCode', JSON.stringify(currentContext), vscode.ConfigurationTarget.Global)
        .then(() => {
          vscode.window.showInformationMessage('Context added');
        }, err => {
          console.error('Error updating contextCode:', err);
          vscode.window.showErrorMessage('Failed to add context');
        });
    } else {
      vscode.window.showErrorMessage('No text selected');
    }
  });

  let getDisposable = vscode.commands.registerCommand('extension.getContext', () => {
    const contextCode = vscode.workspace.getConfiguration().get('contextCode');
    if (contextCode) {
      // Parse the context code JSON
      try {
        const contextData = JSON.parse(contextCode);
        if (panel) {
          // If the panel already exists, just update its content and show the webview
          panel.webview.html = getWebviewContent(contextData);
          panel.reveal(vscode.ViewColumn.One);  // Ensure the panel is shown in the specified column
        } else {
          // Create and show a new webview
          panel = vscode.window.createWebviewPanel(
            'contextCodeView', // Identifies the type of the webview. Used internally
            'Context Code', // Title of the panel displayed to the user
            vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
              enableScripts: true,
              retainContextWhenHidden: true, // Add this line to retain the context
              sandboxOptions: {
                allowScripts: true
              }
            } // Webview options.
          );

          // Set the webview's HTML content
          panel.webview.html = getWebviewContent(contextData);

          panel.onDidDispose(() => {
            panel = null;
          });

          panel.webview.onDidReceiveMessage(
            message => {
              switch (message.command) {
                case 'delete':
                  handleDelete(message.context);
                  break;
                case 'select':
                  handleSelect(message.context, true);
                  break;
                case 'unselect':
                  handleSelect(message.context, false);
                  break;
                case 'saveDefinition':
                  handleSaveDefinition(
                    (currentPage - 1) * 5 + message.index,
                    message.newDefinition,
                    message.newContext
                  );
                  break;
                case 'changePage':
                  currentPage = message.newPage;
                  updateWebview(panel, (currentPage = currentPage));
                  break;
                case 'submitInput':
                  if (message.service === 'chatGpt') {
                    handleGPTSubmitInput(panel, message.inputText, context);
                  } else if (message.service === 'gemini') {
                    handleGeminiSubmitInput(panel, message.inputText, context);
                  } else {
                    console.error('Unknown service:', message.service);
                  }
                  break;
                case 'showContext':
                  handleShowContext(panel, message.service);
                  break;
                case 'clearContext':
                  handleClearContext(panel, message.service);
                  break;
                case 'showSession':
                  handleShowSession(panel, message.service);
                  break;
                case 'clearSession':
                  handleClearSession(panel, message.service);
                  break;
                case 'navigateChat':
                  const activeService = message.service;
                  const direction = message.direction;
                  const serviceSessionData =
                    activeService === 'chatGpt'
                      ? global.chatSessionGPT
                      : global.chatSessionGemini;
                  // Calculate new index based on direction
                  let newIndex = global.currentChatIndex[activeService];
                  if (direction === 'prev') {
                    newIndex = Math.max(0, newIndex - 1);
                  } else if (direction === 'next') {
                    newIndex = Math.min(
                      serviceSessionData.length - 1,
                      newIndex + 1
                    );
                  }
                  global.currentChatIndex[activeService] = newIndex;
                  handleShowSession(panel, activeService);
                  break;
                case 'applySuggestions': // FIXME this is unused
                  handleApplySuggestions(panel, message.service);
                  break;
                case 'applyOneSuggestion':
                  handleApplyOneSuggestion(panel, message.newCode, message.id);
                  break;
                case 'executeSuggestion':
                  executeCommandFromSuggestion(message.newCode);
                  break;
                case 'refreshDefinition':
                  handleRefreshDefinition(
                    (currentPage - 1) * 5 + message.index
                  );
                  break;
              }
            },
            undefined,
            context.subscriptions
          );
        }
      } catch (e) {
        vscode.window.showErrorMessage('Failed to parse context code');
        console.error('Error parsing contextCode:', e);
      }
    } else {
      vscode.window.showErrorMessage('No context code found');
    }
  });

  let addClipboardDisposable = vscode.commands.registerCommand('extension.addClipboardContext', async () => {
    // Read the clipboard content
    const clipboardText = await vscode.env.clipboard.readText();

    if (clipboardText) {
      // Escape special characters or sanitize the clipboard text
      // This can be adjusted based on the specific requirements
      let cleanedClipboardText = clipboardText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      const fileName = 'Clipboard_from_outsource';

      // Retrieve the current contextCode
      const currentContextRaw = vscode.workspace.getConfiguration().get('contextCode');
      let currentContext = [];

      if (currentContextRaw) {
        try {
          // Parse the existing JSON array if it exists
          currentContext = JSON.parse(currentContextRaw);
        } catch (err) {
          console.error('Error parsing existing contextCode:', err);
          // Fallback to an empty array if parsing fails
          currentContext = [];
        }
      }

      // Create a new context object with the clipboard content
      const newContextObj = {
        "context": cleanedClipboardText,
        "definition": "",
        "fileName": fileName
      };

      // Add the new context object
      currentContext.push(newContextObj);

      // Update the contextCode with the new array
      vscode.workspace.getConfiguration().update('contextCode', JSON.stringify(currentContext), vscode.ConfigurationTarget.Global)
        .then(() => {
          vscode.window.showInformationMessage('Clipboard content added to context');
        }, err => {
          console.error('Error updating contextCode with clipboard content:', err);
          vscode.window.showErrorMessage('Failed to add clipboard content to context');
        });
    } else {
      vscode.window.showErrorMessage('Clipboard is empty');
    }
  });

  let addImgContextDisposable = vscode.commands.registerCommand('extension.addImgContext', handleAddImgContext);
  let addSecretKeyDisposable = vscode.commands.registerCommand('extension.addSecretKey', addSecretKey);

  context.subscriptions.push(addDisposable, getDisposable, addClipboardDisposable, addImgContextDisposable, addSecretKeyDisposable);
}

exports.activate = activate;

function deactivate() { }

module.exports = {
  activate,
  deactivate
};