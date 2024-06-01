const vscode = require('vscode');
const fs = require('fs');
const ignore = require('ignore'); // You may need to install ignore
const path = require('path');

function isGitDirectory(filePath) {
    return filePath.includes('/.git') || filePath.includes('\\.git');
}

function scanFiles(dir, allFiles = []) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        if (isGitDirectory(filePath)) {
            // Skip any files or directories that are within .git folders
            return;
        }
        if (fs.statSync(filePath).isDirectory()) {
            scanFiles(filePath, allFiles);
        } else {
            allFiles.push(filePath);
        }
    });
    return allFiles;
}

// Assuming you have a function to handle adding the file contexts
async function handleAddFileContext() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No open workspace.");
        return;
    }

    // Assuming the first workspace folder is the root
    const rootPath = workspaceFolders[0].uri.fsPath;
    const gitignorePath = `${rootPath}/.gitignore`;
    let ig = ignore();

    try {
        const gitignore = fs.readFileSync(gitignorePath, 'utf8');
        ig.add(gitignore.split(/\r?\n/));
    } catch (err) {
        vscode.window.showInformationMessage(".gitignore not found. Scanning all files.");
    }

    let allFiles = scanFiles(rootPath);

    try {
        // Convert allFiles to relative paths with respect to rootPath
        allFiles = allFiles.map(file => path.relative(rootPath, file));
        // Filtering files not ignored by .gitignore
        const trackedFiles = allFiles.filter(file => !ig.ignores(file));
        // Proceed to add these files to your context file
        addToContextFile(rootPath, trackedFiles);
    } catch (err) {
        console.log('Error', err);
    }
}

// Function to handle adding image context
async function handleAddImgContext() {
    // Open a file picker dialog to select an image file
    const options = {
        canSelectMany: false,
        openLabel: 'Select Image File',
        filters: {
            'Image Files': ['png', 'jpg', 'jpeg', 'gif', 'bmp'],
            'All Files': ['*']
        }
    };

    const fileUri = await vscode.window.showOpenDialog(options);

    if (fileUri && fileUri[0]) {
        const selectedFile = fileUri[0].fsPath;

        // Read the image file and convert it to base64
        fs.readFile(selectedFile, 'base64', (err, data) => {
            if (err) {
                vscode.window.showErrorMessage('Failed to read the selected image file.');
                console.error('Error reading image file:', err);
                return;
            }

            const fileName = path.basename(selectedFile);
            const base64Image = `data:image/${path.extname(fileName).slice(1)};base64,${data}`;

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

            // Create a new context object with the image base64 string
            const newContextObj = {
                "context": base64Image,
                "definition": "",
                "fileName": fileName
            };

            // Add the new context object
            currentContext.push(newContextObj);

            // Update the contextCode with the new array
            vscode.workspace.getConfiguration().update('contextCode', JSON.stringify(currentContext), vscode.ConfigurationTarget.Global)
                .then(() => {
                    vscode.window.showInformationMessage('Image content added to context');
                }, err => {
                    console.error('Error updating contextCode with image content:', err);
                    vscode.window.showErrorMessage('Failed to add image content to context');
                });
        });
    } else {
        vscode.window.showWarningMessage('No image file selected');
    }
}


function addToContextFile(rootPath, trackedFiles) {
    // Implement the logic to write file details to .ctx-pilot.cfg
    const configPath = `${rootPath}/.ctx-pilot.cfg`;
    // Example: write or append to the file the tracked files
    fs.writeFileSync(configPath, JSON.stringify(trackedFiles, null, 2), { flag: 'w' });
    vscode.window.showInformationMessage('File context added to .ctx-pilot.cfg');
}

module.exports = {
    handleAddFileContext,
    handleAddImgContext
};