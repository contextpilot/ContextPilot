const vscode = require('vscode');
const axios = require('axios');
const EventSource = require('eventsource');
const utils = require('./utils');
const fs = require('fs');
const path = require('path');

let chatGptResponse = '';
let chatGeminiResponse = '';

global.chatSessionGPT = [];
global.chatSessionGemini = [];
global.chatSessionClaude = [];
global.currentChatIndex = {
  chatGpt: 0,
  gemini: 0,
  claude: 0,
};

// Helper function to manage chat session entries
function manageChatSessionEntries(chatSession, maxSessionLength) {
  while (chatSession.length >= maxSessionLength) {
    if (chatSession.length === maxSessionLength && chatSession[1].role === "user") {
      chatSession.splice(1, 2); // Remove the oldest user-system pair
    } else {
      chatSession.splice(1, 1); // Remove the oldest entry
    }
  }
}

function getCommandByModel(model) {
  let command = 'updateChatGptOutput'; // default command
  
  switch (model) {
    case 'gemini-2.5-pro-preview-05-06':
      command = 'updateGeminiOutput';
      break;
    case 'claude-3-7-sonnet-latest':
      command = 'updateClaudeOutput';
      break;
  }
  
  return command;
}

function getCommandByService(service) {
  let command = 'updateChatGptOutput'; // default command
  
  switch (service) {
    case 'gemini':
      command = 'updateGeminiOutput';
      break;
    case 'claude':
      command = 'updateClaudeOutput';
      break;
  }
  
  return command;
}

function getSessionDataByService(service) {
  let sessionData = global.chatSessionGPT
  
  switch (service) {
    case 'gemini':
      sessionData =  global.chatSessionGemini
      break;
    case 'claude':
      sessionData =  global.chatSessionClaude
      break;
  }
  
  return sessionData;
}

function clearSessionDataByService(service) {
  if (service == "chatGpt") {
    global.chatSessionGPT = [];
  } else if (service == "gemini") {
    global.chatSessionGemini = [];
  } else if (service == "claude") {
    global.chatSessionClaude = [];
  }
}

// Helper function to create the prompt
async function createPrompt(tempContext, inputText) {
  const isBase64Image = (context) => /^data:image\/[a-zA-Z]+;base64,/.test(context);

  const isJsonObject = str => {
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  };
  let txt = '';
  let img_url = '';
  // Replace database connection info with schema
  for (let i = 0; i < tempContext.length; i++) {
    if (isJsonObject(tempContext[i].context)) {
      const jsonContent = JSON.parse(tempContext[i].context);
      if (jsonContent.dbtype && jsonContent.dbname && jsonContent.user && jsonContent.password && jsonContent.host && jsonContent.port) {
        try {
          const { data } = await axios.post('https://api.cryptitalk.com/dbschema', jsonContent);
          tempContext[i].context = formatDBSchema(data);
        } catch (error) {
          console.error('Failed to retrieve database schema:', error);
          tempContext[i].context = 'Failed to retrieve database schema.';
        }
        break;  // Assuming only one item with db connection info
      }
    } 
  }

  // Only add inputText to the non-image parts
  if (!tempContext.some(item => isBase64Image(item.context))) {
    return tempContext.map(item => `In context: ${item.fileName}\n content: ${item.context}\n definition: ${item.definition}`).join('\n') + '\n' + inputText;
  } else {
    for (let i = 0; i < tempContext.length; i++) {
      if (!isBase64Image(tempContext[i].context)) {
        txt += `In context: ${tempContext[i].fileName}\n content: ${tempContext[i].context}\n definition: ${tempContext[i].definition}\n`;
        break;
      } else {
        img_url = tempContext[i].context;
      }
    }
    const ret = [{ type: "text", text: txt + '\n' + inputText }, { type: "image_url", image_url: { url: img_url } }];
    console.log(ret);
    return ret;
  }
}

function formatDBSchema(schema) {
  let formattedSchema = '';
  for (const [tableName, columns] of Object.entries(schema.public)) {
    formattedSchema += `Table: ${tableName}\n`;
    columns.forEach(column => {
      formattedSchema += `  Column: ${column.column_name}, Type: ${column.data_type}, Nullable: ${column.is_nullable}\n`;
    });
  }
  return formattedSchema;
}

// Helper function to post data to an API
async function postDataToAPI(apiEndpoint, headers, body) {
  const messageJsonString = JSON.stringify(body);
  return axios.post(apiEndpoint, { message_json: messageJsonString }, {
    headers: headers
  });
}

async function initEventStream(panel, endpoint, message, command, chatResponse, chatSession, handleResponseFunc) {
  let response = await postDataToAPI(endpoint.replace('streamchat', 'streaminit'), { 'Content-Type': 'application/json' }, message);

  // Fetch the secret key from the configuration
  let secretKey = vscode.workspace.getConfiguration().get('secretKey');
  if (!secretKey) {
    secretKey = 'dummy'
  }

  // Initialize the EventSource with the encoded JSON in the URL query parameter
  let eventSource = new EventSource(`${endpoint}?session_id=${response.data.session_id}&secret_key=${secretKey}`);
  eventSource.onmessage = function (event) {
    var messageData = JSON.parse(event.data);
    chatResponse += messageData.text;
    const md = utils.formatMarkdown(chatResponse, false);
    utils.postMessageToWebview(panel, command, `<div>${md}</div>`);
    if (messageData.finish_reason) {
      eventSource.close();
      handleResponseFunc(chatResponse, chatSession);
    }
  };

  // Define error handling
  eventSource.onerror = function (event) {
    console.error('EventSource failed:', event);
    eventSource.close();
  };
  return eventSource;
}

function listFilesStructure(fileNames, prefix = '') {
  let structure = '';
  fileNames.forEach((fileName) => {
    const parts = fileName.split("/");
    if (parts.length > 1) {
      // Handle subdirectories recursively
      const dirName = parts.shift();
      const rest = parts.join("/");
      if (!structure.includes(`${prefix}${dirName}/`)) {
        structure += `${prefix}${dirName}/\n`;
      }
      structure += listFilesStructure([rest], `${prefix}  `);
    } else {
      structure += `${prefix}- ${fileName}\n`;
    }
  });
  return structure;
}

function prepareSystemPrompt() {
  let ret = "I am a software engineer advisor.";
/*
  // Define the path to your project's .ctx-pilot.cfg file
  const configFilePath = path.join(vscode.workspace.rootPath || '', '.ctx-pilot.cfg');

  // Check if the file exists
  if (fs.existsSync(configFilePath)) {
    try {
      // Read the contents of the file
      const configData = fs.readFileSync(configFilePath, 'utf8');
      // Parse the JSON
      const fileNames = JSON.parse(configData);

      ret += listFilesStructure(fileNames);
    } catch (error) {
      console.error("Error reading or parsing .ctx-pilot.cfg:", error.message);
      return "Error preparing the system prompt.";
    }
  } else {
    // Handle the case where .ctx-pilot.cfg does not exist
    console.warn(".ctx-pilot.cfg file not found.");
    return "Unable to prepare the system prompt because the configuration file was not found.";
  }
*/
  return ret;
}

async function handleChatAPIInput(panel, apiInfo, inputText, context, chatSession, chatResponse) {
  const tempContextRaw = vscode.workspace.getConfiguration().get('tempContextCode');
  let tempContext = tempContextRaw ? JSON.parse(tempContextRaw) : [];

  const { maxSessionLength, constructBodyFunc, handleResponseFunc, apiName } = apiInfo;

  if (chatSession.length === 0) {
    if (apiName == "Gemini") {
      chatSession.push({
        role: "user",
        parts: { text: "I am a software engineer." }
      });
      chatSession.push({
        role: "model",
        parts: { text: "I am a software engineer advisor." }
      });
    } else {
      chatSession.push({
        role: "system",
        content: prepareSystemPrompt()
      });
    }
  }

  manageChatSessionEntries(chatSession, maxSessionLength);

  // Add the new user input to the chatSession
  const prompt = await createPrompt(tempContext, inputText);
  if (apiName == "Gemini") {
    chatSession.push({
      role: 'user',
      parts: { text: prompt }
    });
  } else {
    chatSession.push({
      role: 'user',
      content: prompt
    });
  }
  const command = getCommandByModel(apiInfo.model)
  utils.postMessageToWebview(panel, command, '<div class="loading"><img src="https://storage.googleapis.com/cryptitalk/loading.gif" alt="Loading..."></div>');

  try {
    const requestBody = constructBodyFunc(chatSession);
    await initEventStream(panel, apiInfo.endpoint, requestBody, command, chatResponse, chatSession, handleResponseFunc);
  } catch (err) {
    utils.handleError(err, apiName);
  } finally {
    // Clear the tempContextCode after the API call
    await vscode.workspace.getConfiguration().update('tempContextCode', null, true);
  }
}

// Re-usable function to handle the GPT API input
async function handleGPTSubmitInput(panel, inputText, context, model, chatSession) {
  chatGptResponse = '';
  const apiInfo = {
    maxSessionLength: 10,
    model: model,
    constructBodyFunc: (chatSessionGPT) => ({
      model: model,
      message: chatSessionGPT
    }),
    handleResponseFunc: async (response, chatSessionGPT) => {
      const chatGptResponse = response
      chatSessionGPT.push({
        role: "system",
        content: chatGptResponse
      });
    },
    apiName: "GPT",
    endpoint: "https://api.cryptitalk.com/streamchat"
  };

  await handleChatAPIInput(panel, apiInfo, inputText, context, chatSession, chatGptResponse);
}


async function handleGeminiSubmitInput(panel, inputText, context) {
  const apiInfo = {
    maxSessionLength: 10,
    constructBodyFunc: (chatSessionGemini) => ({
      model: "gemini",
      message: chatSessionGemini
    }),
    handleResponseFunc: async (response, chatSessionGemini) => {
      const geminiResponseContent = response;
      chatSessionGemini.push({
        role: "model",
        parts: { text: geminiResponseContent }
      });
    },
    apiName: "Gemini",
    endpoint: "https://api.cryptitalk.com/streamchat"
  };
  await handleChatAPIInput(panel, apiInfo, inputText, context, global.chatSessionGemini, chatGeminiResponse);
}

module.exports = {
  handleGPTSubmitInput,
  handleGeminiSubmitInput,
  postDataToAPI,
  getCommandByModel,
  getCommandByService,
  getSessionDataByService,
  clearSessionDataByService
};
