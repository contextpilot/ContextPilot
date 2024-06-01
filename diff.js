const difflib = require('difflib');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { handleAddFileContext } = require('./file_ctx');
const { postDataToAPI } = require('./chat');

function update_common(oldText, newText) {
    // Split the text into lines for difflib
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    // Get the unified diff between the two
    const diff = difflib.ndiff(oldLines, newLines);

    let start = 0;
    let end = 0;
    let updatedLines = [];
    for (i = 2; i < diff.length; i++) {
        if (diff[i][0] !== '+') {
            start = i;
            break;
        }
    }

    for (i = diff.length - 1; i >= 0; i--) {
        if (diff[i][0] !== '+') {
            end = i;
            break;
        }
    }

    for (i = start; i <= end; i++) {
        if (diff[i][0] === '+' || diff[i][0] === ' ') {
            updatedLines.push(diff[i].slice(1));
        }
    }

    return updatedLines.join('\n');
}

// TODO improve the accuracy here
async function applyCustomChanges(oldText, newText) {
    try {
        // Send the old and new text to the server
        const message = { oldText, newText };
        const response = await postDataToAPI("https://main-wjaxre4ena-uc.a.run.app/diffcollect", { 'Content-Type': 'application/json' }, message);

        console.log(typeof response.data); // Log the type
        console.log(response.data); // Log the actual data

        let changed = '';
        if (typeof response.data.message === 'string') {
            // Use a regex that matches code blocks accurately, including those with embedded backticks
            const codeBlockRegex = /```(?:[a-zA-Z]+)?\n([\s\S]*?)\n```/gm;
            changed = response.data.message.replace(codeBlockRegex, (match, code) => {
                return code; // Return the code inside the code block
            });
        } else {
            console.error("response.data.message is not a string:", response.data.message);
            throw new Error("API response is not in expected string format");
        }

        return changed;
    } catch (error) {
        console.error("Error in applyCustomChanges:", error.message);
        throw error; // Rethrow the error after logging it
    }
}

// FIXME this is unused
function detectCodeBlocks(text) {
    // Split the text into lines
    const lines = text.split('\n');

    let codeBlocks = [];
    let inCodeBlock = false;
    let currentBlock = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                codeBlocks.push(currentBlock.join('\n'));
                currentBlock = [];
            }
            inCodeBlock = !inCodeBlock;
        } else if (inCodeBlock) {
            currentBlock.push(line);
        }
    }

    return codeBlocks;

}

function readFiles() {
    let ret = []

    // Define the path to your project's .ctx-pilot.cfg file
    const configFilePath = path.join(vscode.workspace.rootPath || '', '.ctx-pilot.cfg');

    // Check if the file exists
    if (!fs.existsSync(configFilePath)) {
        handleAddFileContext();
    }
    try {
        const configData = fs.readFileSync(configFilePath, 'utf8');
        const fileNames = JSON.parse(configData);
        console.log(fileNames);
        for (let i = 0; i < fileNames.length; i++) {
            const fileName = path.join(vscode.workspace.rootPath || '', fileNames[i]);
            if (fs.existsSync(fileName)) {
                const fileData = fs.readFileSync(fileName, 'utf8');
                ret.push({ fileName: fileName, fileData: fileData });
            }
        }
    } catch (error) {
        console.error("Error reading or parsing .ctx-pilot.cfg:", error.message);
    }

    return ret;
}

// FIXME this is unused
function handleApplySuggestions(panel, service) {
    // step 1: get the current chat session, detect code blocks
    const sessionData = service === "chatGpt" ? global.chatSessionGPT : global.chatSessionGemini;
    const currentIndex = global.currentChatIndex[service];
    let sessionText = sessionData[currentIndex].content;
    let codeBlocks = detectCodeBlocks(sessionText);
    let files = readFiles();

    // List to keep track of files that have been changed
    let updatedFiles = [];

    // step 2: based on the chatsession and the file context, determine what files need to be updated
    for (let i = 0; i < codeBlocks.length; i++) {
        const codeBlock = codeBlocks[i];
        let maxSimilarity = 0;
        let bestFile = null;
        for (let j = 0; j < files.length; j++) {
            const file = files[j];
            console.log(file.fileName);
            let s = new difflib.SequenceMatcher(null, codeBlock, file.fileData);
            let ratio = s.ratio();
            if (ratio > maxSimilarity) {
                maxSimilarity = ratio;
                bestFile = file;
            }
        }
        // step 3: update the files with the suggestions
        if (bestFile) {
            let updatedCode = applyCustomChanges(bestFile.fileData, codeBlock);
            fs.writeFileSync(bestFile.fileName, updatedCode);
            // Add the changed file's path to the list
            updatedFiles.push(bestFile.fileName);
        }
    }

    // step 4: notify the webview that the suggestions have been applied
    if (panel && panel.webview) {
        let command = service === "chatGpt" ? 'updateChatGptOutput' : 'updateGeminiOutput';
        let updatedFilesMessage = updatedFiles.length > 0 ? `Updated files: ${updatedFiles.join(', ')}` : 'No files were updated.';
        panel.webview.postMessage({
            command: command,
            htmlContent: `<div>Suggestions applied. Please check gitdiff.<br>${updatedFilesMessage}</div>`
        });
    }
}

async function handleApplyOneSuggestion(panel, newCode, id) {
    // Open a file picker dialog to select a file or a folder
    const options = {
        canSelectFiles: true,        // Allow file selection
        canSelectFolders: true,      // Allow folder selection
        canSelectMany: false,
        openLabel: 'Select a File or Folder to Apply Suggestion',
        filters: {
            'All Files': ['*']
        }
    };

    let fileUri = await vscode.window.showOpenDialog(options);

    if (fileUri && fileUri[0]) {
        const selectedPath = fileUri[0].fsPath;

        fs.stat(selectedPath, (err, stats) => {
            if (err) {
                vscode.window.showErrorMessage(`Failed to access the selected path: ${err.message}`);
                console.error('Error accessing path:', err);
                return;
            }

            if (stats.isDirectory()) {
                // If selected path is a directory, prompt to create a new file in that directory
                vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(selectedPath, 'newFile.txt')),
                    saveLabel: 'Save New File',
                    filters: {
                        'All Files': ['*']
                    }
                }).then((saveUri) => {
                    if (saveUri) {
                        // Create the new file with the applied changes
                        processFile(panel, saveUri.fsPath, '', newCode, id);
                    } else {
                        vscode.window.showWarningMessage('File save cancelled.');
                    }
                });
            } else if (stats.isFile()) {
                // If selected path is a file, read and apply changes
                fs.readFile(selectedPath, 'utf-8', (err, data) => {
                    if (err) {
                        vscode.window.showErrorMessage(`Failed to read the selected file: ${err.message}`);
                        console.error('Error reading file:', err);
                        return;
                    }

                    processFile(panel, selectedPath, data, newCode, id);
                });
            } else {
                vscode.window.showErrorMessage('Selected path is neither a file nor a directory.');
            }
        });
    } else {
        vscode.window.showWarningMessage('No file or folder selected');
    }
}

// Helper function to process the file
async function processFile(panel, filePath, fileData, newCode, id) {
    let bestFile = { fileName: filePath, fileData: fileData };
    panel.webview.postMessage({
        command: 'suggestionApplying',
        id: id
    });

    // Apply custom changes
    let updatedCode = await applyCustomChanges(bestFile.fileData, newCode);

    // Write updated code back to the file
    fs.writeFileSync(bestFile.fileName, updatedCode);

    vscode.window.showInformationMessage(`Changes applied to ${path.basename(bestFile.fileName)}`);
    panel.webview.postMessage({
        command: 'suggestionApplied',
        id: id
    });
}

module.exports = {
    update_common,
    handleApplySuggestions,
    handleApplyOneSuggestion,
    applyCustomChanges
};