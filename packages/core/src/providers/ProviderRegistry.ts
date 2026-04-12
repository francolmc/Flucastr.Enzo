import { LLMProvider } from './types.js';

export class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();
  private enabledProviders: Set<string> = new Set();

  register(name: string, provider: LLMProvider): void {
    this.providers.set(name, provider);
    // Providers are enabled by default
    this.enabledProviders.add(name);
  }

  get(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Check if a provider is enabled
   */
  isEnabled(name: string): boolean {
    return this.enabledProviders.has(name);
  }

  /**
   * Enable or disable a provider
   */
  setEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this.enabledProviders.add(name);
    } else {
      this.enabledProviders.delete(name);
    }
  }

  async getAvailable(): Promise<LLMProvider[]> {
    const available: LLMProvider[] = [];

    for (const [name, provider] of this.providers.entries()) {
      // Check if provider is enabled
      if (!this.isEnabled(name)) {
        continue;
      }

      try {
        const isAvailable = await provider.isAvailable();
        if (isAvailable) {
          available.push(provider);
        }
      } catch (error) {
        console.error(`Error checking availability for provider ${provider.name}:`, error);
      }
    }

    return available;
  }
}
