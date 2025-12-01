import { defineConfig } from 'wxt';

export default defineConfig({
  // Extension manifest configuration
  manifest: {
    name: 'Sift - Smart Shopping Assistant',
    description: 'AI-powered product recommendations based on your ChatGPT research',
    version: '0.1.0',
    permissions: ['storage', 'activeTab'],
    host_permissions: [
      'https://chatgpt.com/*',
      'https://chat.openai.com/*',
      'https://www.amazon.com/*',
      'https://www.bestbuy.com/*',
      'https://www.target.com/*',
      'https://www.walmart.com/*',
    ],
  },
  // Use TypeScript
  srcDir: 'src',
  // Output directory
  outDir: 'dist',
});

