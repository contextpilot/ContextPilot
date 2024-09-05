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

async function handleAddFileContext() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No open workspace.");
        return;
    }

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
        allFiles = allFiles.map(file => path.relative(rootPath, file));
        const trackedFiles = allFiles.filter(file => !ig.ignores(file));
        addToContextFile(rootPath, trackedFiles);
    } catch (err) {
        console.log('Error', err);
    }
}

async function handleAddImgContext() {
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

        fs.readFile(selectedFile, 'base64', (err, data) => {
            if (err) {
                vscode.window.showErrorMessage('Failed to read the selected image file.');
                console.error('Error reading image file:', err);
                return;
            }

            const fileName = path.basename(selectedFile);
            const base64Image = `data:image/${path.extname(fileName).slice(1)};base64,${data}`;

            const currentContextRaw = vscode.workspace.getConfiguration().get('contextCode');
            let currentContext = [];

            if (currentContextRaw) {
                try {
                    currentContext = JSON.parse(currentContextRaw);
                } catch (err) {
                    console.error('Error parsing existing contextCode:', err);
                    currentContext = [];
                }
            }

            const newContextObj = {
                "context": base64Image,
                "definition": "",
                "fileName": fileName
            };

            currentContext.push(newContextObj);

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

// Implement handleAddDbContext to ask users to choose a JSON file and then read and parse the content
async function handleAddDbContext() {
    const options = {
        canSelectMany: false,
        openLabel: 'Select JSON File',
        filters: {
            'JSON Files': ['json'],
            'All Files': ['*']
        }
    };

    const fileUri = await vscode.window.showOpenDialog(options);

    if (fileUri && fileUri[0]) {
        const selectedFile = fileUri[0].fsPath;

        fs.readFile(selectedFile, 'utf8', (err, data) => {
            if (err) {
                vscode.window.showErrorMessage('Failed to read the selected JSON file.');
                console.error('Error reading JSON file:', err);
                return;
            }

            let dbDetails;
            try {
                dbDetails = JSON.parse(data);

                // Validate required fields
                if (!dbDetails.dbtype || !dbDetails.dbname || !dbDetails.user || !dbDetails.password || !dbDetails.host || !dbDetails.port) {
                    throw new Error('Missing required fields');
                }
            } catch (error) {
                vscode.window.showErrorMessage('Invalid JSON or missing required fields');
                console.error('Error parsing JSON file:', error);
                return;
            }

            const currentContextRaw = vscode.workspace.getConfiguration().get('contextCode');
            let currentContext = [];

            if (currentContextRaw) {
                try {
                    currentContext = JSON.parse(currentContextRaw);
                } catch (err) {
                    console.error('Error parsing existing contextCode:', err);
                    currentContext = [];
                }
            }

            // Create a new context object with database details
            const newContextObj = {
                "context": JSON.stringify(dbDetails, null, 2),
                "definition": "DB_CONTEXT:"+dbDetails.dbname,
                "fileName": `${dbDetails.host}:${dbDetails.port}` // Using host and port as fileName
            };

            // Add the new context object
            currentContext.push(newContextObj);

            // Update the contextCode with the new array
            vscode.workspace.getConfiguration().update('contextCode', JSON.stringify(currentContext), vscode.ConfigurationTarget.Global)
                .then(() => {
                    vscode.window.showInformationMessage('Database context added');
                }, err => {
                    console.error('Error updating contextCode:', err);
                    vscode.window.showErrorMessage('Failed to add database context');
                });
        });
    } else {
        vscode.window.showWarningMessage('No JSON file selected');
    }
}

function addToContextFile(rootPath, trackedFiles) {
    const configPath = `${rootPath}/.ctx-pilot.cfg`;
    fs.writeFileSync(configPath, JSON.stringify(trackedFiles, null, 2), { flag: 'w' });
    vscode.window.showInformationMessage('File context added to .ctx-pilot.cfg');
}

module.exports = {
    handleAddFileContext,
    handleAddImgContext,
    handleAddDbContext
};