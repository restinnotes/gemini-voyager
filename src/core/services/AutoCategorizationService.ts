import { storageService } from '@/core/services/StorageService';
import { StorageKeys } from '@/core/types/common';
import { getFolderManager } from '@/pages/content/folder/index';
import type { ConversationReference, Folder } from '@/pages/content/folder/types';

/**
 * Service for handling automatic categorization of conversations using AI.
 * Uses a dedicated "Native Session Classifier" to avoid API costs.
 */
export class AutoCategorizationService {
  private static instance: AutoCategorizationService;
  private isProcessing = false;
  private classifierSessionName = '[Voyager] Classifier';

  private constructor() {}

  public static getInstance(): AutoCategorizationService {
    if (!AutoCategorizationService.instance) {
      AutoCategorizationService.instance = new AutoCategorizationService();
    }
    return AutoCategorizationService.instance;
  }

  /**
   * Triggers the categorization process for the current conversation.
   */
  public async categorizeCurrentConversation(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const currentTitle = this.getCurrentConversationTitle();
      const currentUrl = window.location.href;

      if (!currentTitle) {
        console.warn('[AutoCategorization] Could not determine current conversation title.');
        return;
      }

      // 1. Get folders for prompt
      const folders = await this.getFolders();
      const prompt = this.generatePrompt(currentTitle, folders);

      // 2. Navigate to classifier session
      const classifierUrl = await this.ensureClassifierSession();
      if (!classifierUrl) {
        throw new Error('Failed to create or find classifier session');
      }

      // 3. Navigate to classifier
      this.navigateTo(classifierUrl);

      // 4. Wait for page load and send prompt
      await this.waitForElement('rich-textarea [contenteditable="true"]', 5000);
      const input = document.querySelector('rich-textarea [contenteditable="true"]') as HTMLElement;
      if (!input) throw new Error('Input not found');

      // Set prompt
      input.innerHTML = `<p>${prompt}</p>`;
      input.dispatchEvent(new Event('input', { bubbles: true }));

      // Wait a bit for React to register the input
      await this.delay(300);

      // Click send
      const sendBtn = document.querySelector(
        'button[aria-label*="Send"], button[aria-label*="send"], button[data-tooltip*="Send"], button mat-icon[fonticon="send"], .send-button',
      ) as HTMLElement;
      if (!sendBtn) throw new Error('Send button not found');
      const actualBtn = sendBtn.closest('button') || sendBtn;
      actualBtn.click();

      // 5. Wait for response to complete (wait up to 15s)
      await this.waitForResponseComplete(15000);

      const responseText = this.getLatestResponse();
      const matchedFolder = this.findMatchingFolder(responseText, folders);

      // 6. Navigate back
      this.navigateTo(currentUrl);

      // 7. Apply categorization
      if (matchedFolder) {
        // Wait for folder manager UI to be ready
        await this.delay(1000);
        const folderManager = getFolderManager();
        if (folderManager) {
          const m = currentUrl.match(/\/app\/([a-fA-F0-9]+)/);
          if (m && m[1]) {
            const convRef: ConversationReference = {
              conversationId: m[1],
              title: currentTitle || 'Unknown Conversation',
              url: currentUrl,
              addedAt: Date.now(),
              isGem: false, // We assume it's regular chat
            };
            folderManager.addConversationsToFolder(matchedFolder.id, [convRef]);
            folderManager.highlightSuggestedFolder(matchedFolder.id);
            console.log(`[AutoCategorization] Moved conversation to folder: ${matchedFolder.name}`);
          }
        }
      } else {
        console.log('[AutoCategorization] No matching folder found or AI suggested "None".');
      }
    } catch (error) {
      console.error('[AutoCategorization] Error during categorization:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async waitForElement(
    selector: string,
    timeoutMs: number = 5000,
  ): Promise<Element | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await this.delay(200);
    }
    return null;
  }

  private async waitForResponseComplete(timeoutMs: number = 15000): Promise<void> {
    // A simple heuristic: wait until the "Stop generating" button disappears,
    // or wait for a set time after the latest message starts appearing.
    // For simplicity without depending on exact DOM: waiting a fixed safe time.
    // Since classification is very short (one word), 4 seconds is usually enough.
    await this.delay(4000);
  }

  private getLatestResponse(): string {
    const messages = document.querySelectorAll('message-content');
    if (messages.length === 0) return '';
    const lastMessage = messages[messages.length - 1];
    return lastMessage.textContent || '';
  }

  private findMatchingFolder(response: string, folders: Folder[]): Folder | null {
    const cleanResponse = response
      .trim()
      .toLowerCase()
      .replace(/['"\[\]]/g, '');
    if (cleanResponse === 'none') return null;

    // Direct match
    const exactMatch = folders.find((f) => f.name.toLowerCase() === cleanResponse);
    if (exactMatch) return exactMatch;

    // Partial match
    return folders.find((f) => cleanResponse.includes(f.name.toLowerCase())) || null;
  }

  private getCurrentConversationTitle(): string | null {
    // Attempt to find title from sidebar or header
    const activeItem = document.querySelector(
      'conversation-item.selected, .selected conversation-item, a[aria-current="page"]',
    );
    return activeItem?.textContent?.trim() || document.title || null;
  }

  private async getFolders(): Promise<Folder[]> {
    const result = await storageService.get<any>(StorageKeys.FOLDER_DATA);
    return result.success ? result.data.folders : [];
  }

  private generatePrompt(title: string, folders: Folder[]): string {
    const folderNames = folders.map((f) => f.name).join(', ');
    return `Please categorize the following conversation title into one of these folders: [${folderNames}]. 
Title: "${title}"
Return ONLY the name of the folder. If it doesn't fit any, return "None".`;
  }

  private async ensureClassifierSession(): Promise<string | null> {
    // Search sidebar for classifier session name and return its URL
    const conversations = document.querySelectorAll('conversation-item, .conversation-list-item');
    for (const item of Array.from(conversations)) {
      if (item.textContent?.includes(this.classifierSessionName)) {
        const link = item.closest('a');
        return link?.href || null;
      }
    }

    // If not found, we would ideally create it, but for now we just fail.
    // The user needs to create a conversation named "[Voyager] Classifier"
    console.warn(
      `[AutoCategorization] Please create a conversation named "${this.classifierSessionName}" first.`,
    );
    return null;
  }

  private navigateTo(url: string) {
    if (window.location.href === url) return;

    // Use SPA-friendly navigation if possible
    const link = document.createElement('a');
    link.href = url;
    link.click();
  }
}

export const autoCategorizationService = AutoCategorizationService.getInstance();
