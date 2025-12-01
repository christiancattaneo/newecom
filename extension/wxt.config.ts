import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Sift - Smart Shopping Assistant',
    description: 'AI-powered product recommendations based on your ChatGPT research',
    version: '0.1.0',
    permissions: [
      'storage',
      'activeTab',
      'scripting',  // For programmatic injection on tracked links
      'webNavigation',
    ],
    host_permissions: [
      // ChatGPT
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      // Allow injection on ANY https site (for tracked links from ChatGPT)
      'https://*/*',
    ],
  },
  srcDir: 'src',
  outDir: 'dist',
});
