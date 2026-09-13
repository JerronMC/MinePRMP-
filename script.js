// --- DOM Elements ---
const setupScreen = document.getElementById('setupScreen');
const mainScreen = document.getElementById('mainScreen');
const apiKeyInput = document.getElementById('apiKeyInput');
const apiProvider = document.getElementById('apiProvider');
const customEndpointGroup = document.getElementById('customEndpointGroup');
const customEndpoint = document.getElementById('customEndpoint');
const continueBtn = document.getElementById('continueBtn');
const resetApiBtn = document.getElementById('resetApiBtn');
const notificationArea = document.getElementById('notificationArea');

const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const fileNameDisplay = document.getElementById('fileName');
const consoleOutput = document.getElementById('consoleOutput');
const resultsSection = document.getElementById('resultsSection');
const promptList = document.getElementById('promptList');

// --- Storage Keys ---
const STORAGE_KEY = 'mineprmp_api_key';
const STORAGE_PROVIDER = 'mineprmp_api_provider';
const STORAGE_ENDPOINT = 'mineprmp_api_endpoint';

// --- Initialization ---
function init() {
    const savedKey = localStorage.getItem(STORAGE_KEY);
    if (savedKey) {
        showMainScreen();
    } else {
        showSetupScreen();
    }
}

// --- Setup & UI Logic ---
apiProvider.addEventListener('change', (e) => {
    if (e.target.value === 'other') {
        customEndpointGroup.style.display = 'block';
    } else {
        customEndpointGroup.style.display = 'none';
    }
});

continueBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const provider = apiProvider.value;
    const endpoint = customEndpoint.value.trim();

    if (!key) {
        showNotification("Please enter a valid API Key.", "error");
        return;
    }

    localStorage.setItem(STORAGE_KEY, key);
    localStorage.setItem(STORAGE_PROVIDER, provider);
    if (provider === 'other') localStorage.setItem(STORAGE_ENDPOINT, endpoint);

    showNotification("API Key Saved!", "success");
    showMainScreen();
});

resetApiBtn.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_PROVIDER);
    localStorage.removeItem(STORAGE_ENDPOINT);
    apiKeyInput.value = '';
    showSetupScreen();
});

function showSetupScreen() {
    setupScreen.classList.remove('hidden');
    mainScreen.classList.add('hidden');
}

function showMainScreen() {
    setupScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
}

function showNotification(message, type = "error") {
    notificationArea.textContent = message;
    notificationArea.className = `notification ${type}`;
    notificationArea.classList.remove('hidden');
    
    setTimeout(() => {
        notificationArea.classList.add('hidden');
    }, 4000);
}

// --- File Handling & Terminal ---
uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    fileNameDisplay.textContent = file.name;
    resultsSection.classList.add('hidden');
    promptList.innerHTML = '';
    consoleOutput.innerHTML = ''; 
    
    logToConsole(`> Uploaded: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
    logToConsole('> Initiating unzipping process...');

    await processModFile(file);
});

function logToConsole(message, type = "normal") {
    const p = document.createElement('p');
    p.textContent = message;
    if (type === "system") p.className = "system-msg";
    if (type === "error") p.className = "error-msg";
    consoleOutput.appendChild(p);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// --- Unzipping Logic ---
async function processModFile(file) {
    try {
        const zip = new JSZip();
        const zipContent = await zip.loadAsync(file);
        
        let fileStructure = [];
        let importantData = ""; 
        let fileCount = 0;

        for (const [relativePath, zipEntry] of Object.entries(zipContent.files)) {
            if (!zipEntry.dir) {
                fileCount++;
                logToConsole(`> Extracted: ${relativePath}`);
                fileStructure.push(relativePath);
                
                if ((relativePath.endsWith('.json') || relativePath.endsWith('.js') || relativePath.endsWith('.ts')) && importantData.length < 5000) {
                    const content = await zipEntry.async("string");
                    importantData += `\n--- File: ${relativePath} ---\n${content.substring(0, 500)}\n`;
                }
            }
        }

        logToConsole(`> Unzip complete. Processed ${fileCount} files.`, "system");
        logToConsole('> AI is compiling context data...');
        
        const contextPayload = `Files in Mod:\n${fileStructure.slice(0, 50).join('\n')}\n\nCode Snippets:\n${importantData}`;
        
        await generateAIPrompts(contextPayload);

    } catch (error) {
        logToConsole(`> ERROR: Failed to process file. ${error.message}`, "error");
    }
}

// --- AI API Integration ---
async function generateAIPrompts(contextPayload) {
    logToConsole('> Establishing connection bypassing CORS...', "system");
    
    const key = localStorage.getItem(STORAGE_KEY);
    const provider = localStorage.getItem(STORAGE_PROVIDER);
    
    // We use corsproxy.io to force the browser to allow the connection
    const proxyBase = "https://corsproxy.io/?"; 
    
    let targetUrl = "";
    let model = "";

    if (provider === "groq") {
        targetUrl = "https://api.groq.com/openai/v1/chat/completions";
        model = "llama-3.1-8b-instant"; 
    } else if (provider === "openai") {
        targetUrl = "https://api.openai.com/v1/chat/completions";
        model = "gpt-3.5-turbo";
    } else {
        targetUrl = localStorage.getItem(STORAGE_ENDPOINT);
        model = "default-model"; 
    }

    // Combine the proxy and the encoded target URL
    const finalUrl = proxyBase + encodeURIComponent(targetUrl);

    const promptMessage = `You are a Minecraft Bedrock Modding expert. Analyze the following mod structure and code snippets. Generate 3 to 6 creative modding prompts/ideas based on this specific mod. Output ONLY a valid JSON array of strings, nothing else. Example: ["Prompt 1", "Prompt 2"].\n\nData:\n${contextPayload}`;

    try {
        const response = await fetch(finalUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`,
                // Prevent proxy caching issues
                'x-requested-with': 'XMLHttpRequest'
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: promptMessage }],
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData.error?.message || response.statusText;
            throw new Error(`API Refused: ${errorMsg} (Status: ${response.status})`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        logToConsole('> Response received. Parsing output...', "system");
        
        let prompts = [];
        try {
            const cleanJson = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            prompts = JSON.parse(cleanJson);
        } catch (e) {
            prompts = aiResponse.split('\n').filter(p => p.trim().length > 5);
        }

        displayPrompts(prompts);
        logToConsole('> Task Complete.', "system");

    } catch (error) {
        logToConsole(`> CONNECTION ERROR: ${error.message}`, "error");
        
        if (error.message.includes("401")) {
            logToConsole(`> API Key is likely incorrect. Please change it.`, "error");
            showNotification("Invalid API Key.", "error");
        } else {
            showNotification("Check terminal for error details.", "error");
        }
    }
}

function displayPrompts(prompts) {
    resultsSection.classList.remove('hidden');
    prompts.forEach(promptText => {
        const cleanText = promptText.replace(/^[0-9]+\.\s*/, '').replace(/^-\s*/, '').replace(/^"|"$/g, '');
        const li = document.createElement('li');
        li.textContent = cleanText;
        promptList.appendChild(li);
    });
}

// Run on page load
init();
