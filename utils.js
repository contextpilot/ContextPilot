const vscode = require('vscode');
const showdown = require('showdown');
const path = require('path');
const { exec } = require("child_process");

function getRelativeFilePath() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active text editor found.');
        return;
    }

    const fileName = editor.document.fileName;
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (workspaceFolders) {
        for (const folder of workspaceFolders) {
            console.log('folder.uri.fsPath:', folder.uri.fsPath);
            if (fileName.startsWith(folder.uri.fsPath)) {
                const relativePath = path.relative(folder.uri.fsPath, fileName);
                return relativePath;
            }
        }
        vscode.window.showErrorMessage('The file is not in the current workspace folders.');
    } else {
        vscode.window.showErrorMessage('No workspace folder found.');
    }
}

function formatMarkdown(markdownText, isCode = false) {
    const converter = new showdown.Converter();
    let html;
    if (isCode) {
        const base64ImageRegex = /data:image\/(png|jpg|jpeg|gif);base64,([A-Za-z0-9+/=]+)\s*/g;
        let isImage = false;
        let formattedMarkdown = markdownText.replace(base64ImageRegex, (match, type, base64) => {
            console.log("detected image type:", type);
            isImage = true;
            return `<img src="data:image/${type};base64,${base64}" alt="Base64 Image" />`;
        });
        console.log("isImage:", isImage);
        if (!isImage) {
            formattedMarkdown = "```\n" + markdownText + "\n```";
            html = converter.makeHtml(formattedMarkdown);
            return html;
        }
        return formattedMarkdown;
    } else {
        const codeBlockRegex = /```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```/gm;
        let formattedMarkdown = markdownText.replace(codeBlockRegex, (match, code, offset) => {
            const id = `codeblock-${offset}`;
            const encodedCode = btoa(unescape(encodeURIComponent(code)));
            console.log("code", code)
            console.log("encode", encodedCode)
            const codeWithBackticks = `\`\`\`\n${code}\n\`\`\``;
            const buttonHtml = `<button id="apply-${id}" onclick="applyOneSuggestion('${id}')">Apply Suggestion</button>`;
            const copyButtonHtml = `<button onclick="copyToClipboard('${id}')">Copy</button>`;
            const hiddenCodeBlock = `<div id="${id}" style="display: none;">${encodedCode}</div>`;
            const executeButtonHtml = `<button onclick="executeSuggestion('${id}')" style="margin-left: 10px;">Execute</button>`;
            return codeWithBackticks + buttonHtml + copyButtonHtml + executeButtonHtml + hiddenCodeBlock;
        });
        html = converter.makeHtml(formattedMarkdown);
    }
    return html;
}

function executeCommandFromSuggestion(code) {
    // Create a new terminal or use an existing one
    let terminal = vscode.window.terminals.find(t => t.name === 'Command Execution Terminal');

    if (!terminal) {
        terminal = vscode.window.createTerminal('Command Execution Terminal');
    }

    // Show the terminal and execute the command
    terminal.show();
    terminal.sendText(code, true); // true indicates that the command should be run
}

function getSafeContext(contextText) {
    // escape special characters or sanitize the context text...
    // ...
}

// Helper function to handle errors from the API communication
function handleError(err, apiName) {
    console.error(`Error communicating with ${apiName} API:`, err.message);
    if (err.response) {
        console.error('Response Status:', err.response.status);
        console.error('Response Status Text:', err.response.statusText);
        console.error('Response Data:', err.response.data ? JSON.stringify(err.response.data).substring(0, 500) : 'No data');
    } else {
        console.error('No response received from the server');
    }
    vscode.window.showErrorMessage(`Failed to get response from ${apiName}`);
}

// Helper function to post a message to the webview
function postMessageToWebview(panel, command, htmlContent) {
    if (panel && panel.webview) {
        panel.webview.postMessage({
            command: command,
            htmlContent: htmlContent
        });
    }
}


function maskSensitiveInfo(context) {
    const config = vscode.workspace.getConfiguration();
    let originalValues = {};

    try {
        // Parse the context as a JSON object
        let parsedContext = JSON.parse(context);

        // Mask passwords and keep the original
        traverseAndMask(parsedContext, originalValues);

        // Store the original values in configuration
        config.update('sensitiveInfo.originalValues', JSON.stringify(originalValues), vscode.ConfigurationTarget.Global);

        // Convert back to JSON string
        return JSON.stringify(parsedContext, null, 2);
    } catch (err) {
        console.error('Error masking sensitive info:', err);
        return context; // Return the original context if parsing fails
    }
}

function traverseAndMask(obj, originalValues, path = '') {
    for (let key in obj) {
        if (obj.hasOwnProperty(key)) {
            const currentPath = path ? `${path}.${key}` : key;
            if (key.toLowerCase() === 'password' || key.toLowerCase() === 'host') {
                originalValues[currentPath] = obj[key]; // Store the original value
                obj[key] = '***'; // Mask the password
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                traverseAndMask(obj[key], originalValues, currentPath); // Recursively traverse nested objects
            }
        }
    }
}

function recoverSensitiveInfo(context) {
    const config = vscode.workspace.getConfiguration();
    try {
        // Retrieve the original values from configuration
        const originalValues = JSON.parse(config.get('sensitiveInfo.originalValues', '{}'));

        // Parse the context as a JSON object
        let parsedContext = JSON.parse(context);

        // Recover passwords and hosts
        traverseAndRecover(parsedContext, originalValues);

        // Convert back to JSON string
        return JSON.stringify(parsedContext, null, 2);
    } catch (err) {
        console.error('Error recovering sensitive info:', err);
        return context; // Return the original context if parsing fails
    }
}

function traverseAndRecover(obj, originalValues, path = '') {
    for (let key in obj) {
        if (obj.hasOwnProperty(key)) {
            const currentPath = path ? `${path}.${key}` : key;
            if (originalValues[currentPath] !== undefined) {
                obj[key] = originalValues[currentPath]; // Recover the original value
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                traverseAndRecover(obj[key], originalValues, currentPath); // Recursively traverse nested objects
            }
        }
    }
}

module.exports = {
    formatMarkdown,
    getSafeContext,
    handleError,
    postMessageToWebview,
    getRelativeFilePath,
    executeCommandFromSuggestion,
    maskSensitiveInfo,
    recoverSensitiveInfo
};