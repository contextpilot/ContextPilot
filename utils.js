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
        // If directly formatting a piece of code, enclose in Markdown code block syntax
        // Regex to detect base64 images and replace with img tag
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
        // Regex to capture optional language specifier and the code
        const codeBlockRegex = /```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```/gm;
        let formattedMarkdown = markdownText.replace(codeBlockRegex, (match, code, offset) => {
            // Generate a unique identifier for each code block
            const id = `codeblock-${offset}`;
            // Prepare the code with backticks
            const codeWithBackticks = `\`\`\`\n${code}\n\`\`\``;
            // Creating an HTML snippet for the code block without converting to HTML yet.
            const buttonHtml = `<button id="apply-${id}" onclick="applyOneSuggestion('${id}')">Apply Suggestion</button>`;
            const copyButtonHtml = `<button onclick="copyToClipboard('${id}')">Copy</button>`;
            const hiddenCodeBlock = `<div id="${id}" style="display: none;">${code}</div>`;
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


// More utility functions...

module.exports = {
    formatMarkdown,
    getSafeContext,
    handleError,
    postMessageToWebview,
    getRelativeFilePath,
    executeCommandFromSuggestion
    // Export other utilities as needed...
};